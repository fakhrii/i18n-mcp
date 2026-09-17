import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";

export function ProfileScreen() {
  const { t } = useTranslation("profile");

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t("TITLE")}</Text>
      <Text style={styles.subtitle}>Manage your personal settings</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: "bold" },
  subtitle: { fontSize: 14, color: "#666", marginTop: 4 },
});
