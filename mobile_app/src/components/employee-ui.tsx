import { useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const employeeColors = {
  navy: '#101B33',
  blue: '#4667E8',
  green: '#2A9D77',
  amber: '#CA8B24',
  red: '#B54747',
  ink: '#17233C',
  muted: '#78839A',
  line: '#E9EDF3',
  paper: '#F7F8FB',
  white: '#FFFFFF',
};

export function EmployeePage({
  children,
  refreshing = false,
  onRefresh,
}: PropsWithChildren<{ refreshing?: boolean; onRefresh?: () => void }>) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.pageContent}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[employeeColors.blue]}
              tintColor={employeeColors.blue}
            />
          ) : undefined
        }>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function EmployeeHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>OFFICE ATTENDANCE</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {action}
    </View>
  );
}

export function EmployeeCard({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function EmployeeField({
  label,
  error,
  ...inputProps
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={employeeColors.muted}
        selectionColor={employeeColors.blue}
        style={[
          styles.input,
          inputProps.multiline && styles.multilineInput,
          error && styles.inputError,
        ]}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function EmployeeButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'secondary' ? employeeColors.navy : employeeColors.white}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant !== 'secondary' && styles.buttonTextLight,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function EmployeeNotice({
  title,
  message,
  tone = 'info',
  action,
}: {
  title: string;
  message: string;
  tone?: 'info' | 'error' | 'success';
  action?: ReactNode;
}) {
  return (
    <View
      accessibilityLiveRegion={tone === 'error' ? 'polite' : undefined}
      style={[
        styles.notice,
        tone === 'error' && styles.noticeError,
        tone === 'success' && styles.noticeSuccess,
      ]}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeMessage}>{message}</Text>
      {action}
    </View>
  );
}

export function EmployeeLoading({ message }: { message: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={employeeColors.blue} />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

export function EmployeeBadge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'muted' | 'green' | 'amber' | 'red';
}) {
  return (
    <View
      style={[
        styles.badge,
        tone === 'green' && styles.badgeGreen,
        tone === 'amber' && styles.badgeAmber,
        tone === 'red' && styles.badgeRed,
      ]}>
      <Text
        style={[
          styles.badgeText,
          tone === 'green' && styles.badgeTextGreen,
          tone === 'amber' && styles.badgeTextAmber,
          tone === 'red' && styles.badgeTextRed,
        ]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: employeeColors.paper,
  },
  pageContent: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 3,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: employeeColors.blue,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    color: employeeColors.navy,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 4,
  },
  subtitle: {
    color: employeeColors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  card: {
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: employeeColors.line,
    backgroundColor: employeeColors.white,
    shadowColor: '#1C2A3A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.035,
    shadowRadius: 10,
    elevation: 2,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    color: employeeColors.ink,
    fontSize: 11,
    fontWeight: '700',
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: employeeColors.line,
    borderRadius: 11,
    backgroundColor: '#FBFCFE',
    color: employeeColors.ink,
    fontSize: 13,
  },
  multilineInput: {
    minHeight: 96,
    paddingTop: 11,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: employeeColors.red,
  },
  fieldError: {
    color: employeeColors.red,
    fontSize: 10,
  },
  button: {
    minHeight: 45,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 11,
  },
  buttonPrimary: {
    backgroundColor: employeeColors.navy,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: employeeColors.line,
    backgroundColor: employeeColors.white,
  },
  buttonDanger: {
    backgroundColor: employeeColors.red,
  },
  buttonText: {
    color: employeeColors.navy,
    fontSize: 12,
    fontWeight: '800',
  },
  buttonTextLight: {
    color: employeeColors.white,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.75,
  },
  notice: {
    padding: 13,
    borderWidth: 1,
    borderColor: employeeColors.line,
    borderRadius: 13,
    backgroundColor: '#F4F6FA',
    gap: 4,
  },
  noticeError: {
    borderColor: '#F0D1D1',
    backgroundColor: '#FFF5F5',
  },
  noticeSuccess: {
    borderColor: '#CDE8DB',
    backgroundColor: '#F1FAF5',
  },
  noticeTitle: {
    color: employeeColors.navy,
    fontSize: 11,
    fontWeight: '800',
  },
  noticeMessage: {
    color: employeeColors.muted,
    fontSize: 10,
    lineHeight: 15,
  },
  loading: {
    minHeight: 90,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  loadingText: {
    color: employeeColors.muted,
    fontSize: 11,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    backgroundColor: '#F0F2F6',
  },
  badgeGreen: {
    backgroundColor: '#E9F7F0',
  },
  badgeAmber: {
    backgroundColor: '#FFF4E2',
  },
  badgeRed: {
    backgroundColor: '#FDEAEA',
  },
  badgeText: {
    color: employeeColors.muted,
    fontSize: 9,
    fontWeight: '800',
  },
  badgeTextGreen: {
    color: employeeColors.green,
  },
  badgeTextAmber: {
    color: employeeColors.amber,
  },
  badgeTextRed: {
    color: employeeColors.red,
  },
});
