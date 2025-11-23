import React, { useState } from "react";
import {
  View,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { SmsForm } from "./SmsForm";
import { OtpForm } from "./OtpForm";

export interface SignInFormProps {}

export const SignInForm: React.FC<SignInFormProps> = () => {
  const { colors } = useTheme();
  const [flowId, setFlowId] = useState("");

  const handleSignInSuccess = (newFlowId: string) => {
    setFlowId(newFlowId);
  };

  const handleVerifySuccess = () => {
    setFlowId("");
  };

  const handleBack = () => {
    setFlowId("");
  };

  const createStyles = () =>
    StyleSheet.create({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      keyboardContainer: {
        flex: 1,
      },
      contentContainer: {
        flex: 1,
        justifyContent: "flex-end",
        paddingHorizontal: 20,
        paddingBottom: Platform.OS === "ios" ? 40 : 20,
      },
    });

  const styles = createStyles();

  // If we have a flowId, show the OTP form
  if (flowId) {
    return (
      <View style={styles.container}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardContainer}
          keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
        >
          <View style={styles.contentContainer}>
            <OtpForm
              flowId={flowId}
              onSuccess={handleVerifySuccess}
              onBack={handleBack}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // Otherwise show the SMS form
  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardContainer}
        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
      >
        <View style={styles.contentContainer}>
          <SmsForm onSuccess={handleSignInSuccess} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};
