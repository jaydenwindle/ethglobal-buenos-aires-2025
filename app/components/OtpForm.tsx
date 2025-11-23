import React, { useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  TextInput,
  Alert,
} from "react-native";
import { useVerifySmsOTP } from "@coinbase/cdp-hooks";
import { useTheme } from "../theme/ThemeContext";
import { useSignInFormStyles } from "../hooks/useSignInFormStyles";

export interface OtpFormProps {
  flowId: string;
  onSuccess: () => void;
  onBack: () => void;
}

export const OtpForm: React.FC<OtpFormProps> = ({ flowId, onSuccess, onBack }) => {
  const { colors } = useTheme();
  const { verifySmsOTP } = useVerifySmsOTP();
  const styles = useSignInFormStyles();
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleVerifyOTP = async () => {
    if (!otp || !flowId) {
      Alert.alert("Error", "Please enter the OTP.");
      return;
    }

    setIsLoading(true);
    try {
      await verifySmsOTP({ flowId, otp });
      setOtp("");
      onSuccess();
    } catch (error) {
      Alert.alert("Error", error instanceof Error ? error.message : "Failed to verify OTP.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack} disabled={isLoading}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Check your phone</Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.inputLabel}>Verification code</Text>
        <TextInput
          style={styles.input}
          value={otp}
          onChangeText={setOtp}
          placeholder="Enter 6-digit code"
          keyboardType="number-pad"
          maxLength={6}
          editable={!isLoading}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="done"
          onSubmitEditing={handleVerifyOTP}
          blurOnSubmit={true}
          autoFocus={true}
        />

        <TouchableOpacity
          style={[styles.continueButton, isLoading && styles.buttonDisabled]}
          onPress={handleVerifyOTP}
          disabled={isLoading}
        >
          <Text style={styles.continueButtonText}>
            {isLoading ? "Verifying..." : "Verify Code"}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
};
