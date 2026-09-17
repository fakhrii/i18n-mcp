import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

export function LoginScreen() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Welcome back</Text>
      <TextInput
        style={styles.input}
        placeholder="Enter your email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Enter your password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TouchableOpacity style={styles.button}>
        <Text style={styles.buttonText}>{t("LOGIN")}</Text>
      </TouchableOpacity>
      <TouchableOpacity>
        <Text style={styles.linkText}>{t("FORGOT_PASSWORD")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { fontSize: 24, fontWeight: "bold" },
  input: { height: 40, borderColor: "gray", borderWidth: 1, marginBottom: 12 },
  button: { backgroundColor: "blue", padding: 10 },
  buttonText: { color: "white", textAlign: "center" },
  linkText: { color: "blue", marginTop: 8 },
});
