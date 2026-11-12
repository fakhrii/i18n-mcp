import { describe, it, expect } from "vitest";
import { scanDartSourceFile } from "../../src/core/scanner/dart-scanner.js";
import { generateSemanticKey } from "../../src/core/keys/key-generator.js";
import { resolveKeyCollision } from "../../src/core/planning/key-collision-resolver.js";
import {
  isOnlyVariablesAndPunctuation,
  isMaskOrPlaceholderPattern,
  classifyString,
} from "../../src/core/classifier/classifier.js";

describe("Flutter Clean Extraction & Legible Key Generation", () => {
  describe("1. False-Positive Technical Extractions Prevention", () => {
    it("ignores pure bullets and obscuring symbols without letters ('•')", () => {
      const code = `
        Widget build(BuildContext context) {
          return PinCodeTextField(
            obscuringWidget: Text('•'),
          );
        }
      `;

      const results = scanDartSourceFile({
        filePath: "lib/core/basecomponents/otp_field_widget.dart",
        sourceCode: code,
      });

      expect(results).toHaveLength(0);
    });

    it("ignores developer logger calls (logger.f, logger.d, logger.i, print, debugPrint)", () => {
      const code = `
        void handleResponse(Response data) async {
          logger.f('XXXXXXX: \${await data.decodeJson()}');
          logger.d('$route: onResume');
          debugPrint('Debug trace: $info');
        }
      `;

      const results = scanDartSourceFile({
        filePath: "lib/core/bo_notification_remote_datasource_impl.dart",
        sourceCode: code,
      });

      expect(results).toHaveLength(0);
    });

    it("ignores internal exception assertions (throw Exception, throw ArgumentError, assert)", () => {
      const code = `
        void buildTransition() {
          assert(animation != null, 'Animation must not be null');
          if (type == null) {
            throw Exception('Animation type is invalid or null');
          }
        }
      `;

      const results = scanDartSourceFile({
        filePath: "lib/core/route_transation.dart",
        sourceCode: code,
      });

      expect(results).toHaveLength(0);
    });

    it("ignores PAN and credit card masking patterns ($firstFour-XXXX-XXXX-$lastFour)", () => {
      const code = `
        String formatCard(String firstFour, String lastFour) {
          final String formattedCardNumber = '$firstFour-XXXX-XXXX-$lastFour';
          return formattedCardNumber;
        }
      `;

      expect(isMaskOrPlaceholderPattern("$firstFour-XXXX-XXXX-$lastFour")).toBe(true);

      const results = scanDartSourceFile({
        filePath: "lib/core/string_ext.dart",
        sourceCode: code,
      });

      expect(results).toHaveLength(0);
    });

    it("ignores templates containing only variables, newlines, and punctuation", () => {
      // 1. Newline prefixed variable
      const code1 = `
        Widget build(BuildContext context) {
          return Text('\\n$beneficiaryName');
        }
      `;
      const res1 = scanDartSourceFile({
        filePath: "lib/core/bottom_sheet_helper.dart",
        sourceCode: code1,
      });
      expect(res1).toHaveLength(0);

      // 2. Unicode bullet list item
      const code2 = `
        Widget build(BuildContext context) {
          return AutoSizeText("""\\u2022  \${provider.guideline}""");
        }
      `;
      const res2 = scanDartSourceFile({
        filePath: "lib/features/transfer/alias_detail_screen.dart",
        sourceCode: code2,
      });
      expect(res2).toHaveLength(0);

      // 3. Error metadata concatenation
      const code3 = `
        void handleError() {
          final msg = '\${error.message}\\n \${error.providerCode} - \${error.statusCode}';
        }
      `;
      const res3 = scanDartSourceFile({
        filePath: "lib/core/base_view_model.dart",
        sourceCode: code3,
      });
      expect(res3).toHaveLength(0);
    });

    it("ignores constants definition files and top-level const definitions", () => {
      const code = `
        const String qatariCurrency = 'Qatari Riyal (QAR)';
        const String nonResidentType = 'Non Resident';
        const String digitalPrepaidCard = 'Digital Prepaid Card';
      `;

      const results = scanDartSourceFile({
        filePath: "lib/core/utils/constants/app_constants.dart",
        sourceCode: code,
      });

      expect(results).toHaveLength(0);
    });

    it("still extracts genuine user-facing Flutter text in widgets", () => {
      const code = `
        Widget build(BuildContext context) {
          return Column(
            children: [
              Text('Welcome to Dukhan Bank'),
              ElevatedButton(
                onPressed: () {},
                child: Text('Transfer Funds'),
              ),
            ],
          );
        }
      `;

      const results = scanDartSourceFile({
        filePath: "lib/features/voice_agent/chat_screen.dart",
        sourceCode: code,
      });

      expect(results).toHaveLength(2);
      expect(results[0]!.text).toBe("Welcome to Dukhan Bank");
      expect(results[0]!.suggestedKey).toBe("welcomeToDukhanBank");
      expect(results[1]!.text).toBe("Transfer Funds");
      expect(results[1]!.suggestedKey).toBe("transferFunds");
    });
  });

  describe("2. Legible & Idiomatic Translation Key Naming ('lisible')", () => {
    it("drops trailing stop words from sentence keys (prevents 'isInvalidOr')", () => {
      const key = generateSemanticKey(
        "Animation type is invalid or null",
        undefined,
        "lowerCamelCase"
      );
      // Words are [animation, type, is, invalid, or, null].
      // Capped at 5 words without stop word at end -> "animationTypeIsInvalid"
      expect(key).toBe("animationTypeIsInvalid");
      expect(key.endsWith("Or")).toBe(false);
    });

    it("never generates single-character 'n' or bullet 'u2022' keys", () => {
      const key1 = generateSemanticKey("\\n$beneficiaryName", "Text", "lowerCamelCase");
      expect(key1).not.toBe("n");
      expect(key1).not.toBe("textText");
      expect(key1).toBe("beneficiaryName");

      const key2 = generateSemanticKey("\\u2022 $item", "Text", "lowerCamelCase");
      expect(key2).not.toBe("u2022");
      expect(key2).toBe("item");
    });

    it("resolves key collisions in Flutter with lowerCamelCase and strips Dart expressions", () => {
      const existingKeys = new Set(["transferFunds"]);

      const resolution = resolveKeyCollision(
        "transferFunds",
        "Transfer Funds to Another Account",
        "intl_en",
        existingKeys,
        undefined,
        "lowerCamelCase"
      );

      expect(resolution.action).toBe("CREATE");
      // Must NOT be UPPER_SNAKE_CASE
      expect(resolution.key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      expect(resolution.key).not.toContain("_");
    });

    it("never leaks Dart code or expressions into collision key names", () => {
      const existingKeys = new Set(["guidelines"]);

      const resolution = resolveKeyCollision(
        "guidelines",
        "\\u2022  \${provider.aliasMobileNumberGuidelinesList[index]}",
        "intl_en",
        existingKeys,
        undefined,
        "lowerCamelCase"
      );

      expect(resolution.action).toBe("CREATE");
      expect(resolution.key).not.toContain("ALIASMOBILENUMBERGUIDELINESLISTINDEX");
      expect(resolution.key).not.toContain("U2022");
    });
  });

  describe("3. Strict Flutter Context Guardrails & Non-UI Architecture Layers", () => {
    it("never extracts strings from AppConstants or constants files (static const, static final, Map)", () => {
      const appConstantsCode = `
        class AppConstants {
          static const String appName = 'Dukhan Bank Mobile';
          static const String defaultCurrency = 'QAR';
          static final String baseUrl = 'https://api.dukhanbank.com';
          static const Map<String, String> statusLabels = {
            'active': 'Active Account',
            'pending': 'Pending Review',
            'blocked': 'Blocked User',
          };
          static const List<String> supportedLanguages = ['English', 'Arabic'];
        }
      `;

      // Test 1: In a constants directory
      const res1 = scanDartSourceFile({
        filePath: "lib/core/constants/app_constants.dart",
        sourceCode: appConstantsCode,
      });
      expect(res1).toHaveLength(0);

      // Test 2: In a general core file named app_constants.dart
      const res2 = scanDartSourceFile({
        filePath: "lib/app_constants.dart",
        sourceCode: appConstantsCode,
      });
      expect(res2).toHaveLength(0);

      // Test 3: Even if in an arbitrary file, static and const declarations are ignored
      const res3 = scanDartSourceFile({
        filePath: "lib/features/voice_agent/constants.dart",
        sourceCode: appConstantsCode,
      });
      expect(res3).toHaveLength(0);
    });

    it("never extracts strings from Clean Architecture non-UI layers (data, domain, models, network, services)", () => {
      const modelCode = `
        class UserModel {
          final String id;
          final String name;
          final String role;
          UserModel({required this.id, required this.name, required this.role});

          factory UserModel.fromJson(Map<String, dynamic> json) {
            return UserModel(
              id: json['id'] ?? 'user_default_id',
              name: json['name'] ?? 'Guest User',
              role: json['role'] ?? 'Standard Account',
            );
          }
        }
      `;

      // 1. Data layer model
      const resModel = scanDartSourceFile({
        filePath: "lib/features/auth/data/models/user_model.dart",
        sourceCode: modelCode,
      });
      expect(resModel).toHaveLength(0);

      // 2. Data source implementation
      const datasourceCode = `
        class ChatRemoteDataSourceImpl implements ChatRemoteDataSource {
          Future<Response> sendMessage(String text) async {
            final endpoint = '/api/v1/voice/chat';
            final headers = {'Content-Type': 'application/json'};
            return http.post(endpoint, headers: headers, body: '{"msg": "Hello"}');
          }
        }
      `;
      const resDatasource = scanDartSourceFile({
        filePath: "lib/features/voice_agent/data/datasources/chat_remote_datasource_impl.dart",
        sourceCode: datasourceCode,
      });
      expect(resDatasource).toHaveLength(0);

      // 3. Domain layer entity
      const entityCode = `
        class VoiceSessionEntity {
          final String sessionId;
          final String status;
          VoiceSessionEntity({required this.sessionId, required this.status});
        }
      `;
      const resEntity = scanDartSourceFile({
        filePath: "lib/features/voice_agent/domain/entities/voice_session_entity.dart",
        sourceCode: entityCode,
      });
      expect(resEntity).toHaveLength(0);

      // 4. HTTP strategy helper
      const strategyCode = `
        class HttpStrategyHelper {
          static const String authHeader = 'Bearer token';
          static const String defaultTimeout = 'Timeout occurred';
        }
      `;
      const resStrategy = scanDartSourceFile({
        filePath: "lib/core/http_strategy_helper/http_strategy_helper.dart",
        sourceCode: strategyCode,
      });
      expect(resStrategy).toHaveLength(0);
    });

    it("ignores class field initializers and parameter defaults in Flutter widgets", () => {
      const widgetCode = `
        class VoiceModePanel extends StatefulWidget {
          final String panelTitle = 'Voice Mode Settings'; // Field initializer (no context!)
          static const String tag = 'VoiceModePanel'; // Static const (no context!)
          final String initialStatus;

          const VoiceModePanel({
            Key? key,
            this.initialStatus = 'Ready to listen', // Parameter default (must remain compile-time const!)
          }) : super(key: key);

          @override
          _VoiceModePanelState createState() => _VoiceModePanelState();
        }

        class _VoiceModePanelState extends State<VoiceModePanel> {
          final String localField = 'Internal State'; // State field (no context during initialization!)

          @override
          Widget build(BuildContext context) {
            return Container(
              child: Text('Start Speaking Now'), // Genuine UI string inside build!
            );
          }
        }
      `;

      const results = scanDartSourceFile({
        filePath: "lib/features/voice_agent/presentation/voice_mode_panel.dart",
        sourceCode: widgetCode,
      });

      // ONLY 'Start Speaking Now' in Text widget inside build() should be extracted!
      expect(results).toHaveLength(1);
      expect(results[0]!.text).toBe("Start Speaking Now");
      expect(results[0]!.suggestedKey).toBe("startSpeakingNow");
      expect(results[0]!.hasBuildContext).toBe(true);
    });

    it("ignores top-level variables and annotations in UI files", () => {
      const code = `
        final String kDefaultRoute = '/voice-assistant';
        const String kGlobalTag = 'VoiceModule';
        final kEndpoint = 'https://voice.dukhan.qa';

        @Route('voice_screen')
        class VoiceScreen extends StatelessWidget {
          @override
          Widget build(BuildContext context) {
            return Scaffold(
              body: Text('Welcome to Voice Agent'),
            );
          }
        }
      `;

      const results = scanDartSourceFile({
        filePath: "lib/features/voice_agent/presentation/voice_screen.dart",
        sourceCode: code,
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.text).toBe("Welcome to Voice Agent");
      expect(results[0]!.suggestedKey).toBe("welcomeToVoiceAgent");
      expect(results[0]!.hasBuildContext).toBe(true);
    });

    it("distinguishes presentation controller methods (hasBuildContext=false) from widget build (hasBuildContext=true)", () => {
      const controllerCode = `
        class VoiceChatController extends GetxController {
          final RxString message = ''.obs;

          void onConnectionTimeout() {
            message.value = 'Connection timed out. Please try again.';
          }
        }
      `;

      const results = scanDartSourceFile({
        filePath: "lib/features/voice_agent/presentation/controllers/voice_chat_controller.dart",
        sourceCode: controllerCode,
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.text).toBe("Connection timed out. Please try again.");
      expect(results[0]!.hasBuildContext).toBe(false);
    });
  });
});
