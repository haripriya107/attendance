import { useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const adminColors = {
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

export function AdminPage({
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
              colors={[adminColors.blue]}
              tintColor={adminColors.blue}
            />
          ) : undefined
        }>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function AdminHeader({
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
      <View style={styles.headerText}>
        <Text style={styles.eyebrow}>OFFICE ATTENDANCE</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {action}
    </View>
  );
}

export function AdminCard({
  children,
  style,
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function AdminField({
  label,
  error,
  ...inputProps
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        placeholderTextColor={adminColors.muted}
        selectionColor={adminColors.blue}
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

export type AdminSelectOption<T extends string = string> = {
  label: string;
  value: T;
};

export function AdminSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  error,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly AdminSelectOption<T>[];
  onChange: (value: T) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? 'Select';

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selectedLabel}`}
        accessibilityState={{ disabled, expanded: visible }}
        disabled={disabled}
        onPress={() => setVisible(true)}
        style={[styles.selectButton, disabled && styles.disabled]}>
        <Text style={[styles.selectText, !value && styles.selectPlaceholder]}>
          {selectedLabel}
        </Text>
        <Text style={styles.selectChevron}>⌄</Text>
      </Pressable>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}

      <Modal
        animationType="slide"
        transparent
        visible={visible}
        onRequestClose={() => setVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close options"
            onPress={() => setVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.selectSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{label}</Text>
            <ScrollView>
              {options.map((option) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.value === value }}
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setVisible(false);
                  }}
                  style={[
                    styles.optionRow,
                    option.value === value && styles.optionRowSelected,
                  ]}>
                  <Text
                    style={[
                      styles.optionText,
                      option.value === value && styles.optionTextSelected,
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function AdminButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
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
        compact && styles.buttonCompact,
        (disabled || loading) && styles.disabled,
        pressed && styles.buttonPressed,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'danger' ? adminColors.white : adminColors.navy}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant === 'primary' && styles.buttonTextLight,
            variant === 'danger' && styles.buttonTextLight,
            compact && styles.buttonTextCompact,
          ]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function AdminNotice({
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
      <Text
        style={[
          styles.noticeTitle,
          tone === 'error' && styles.noticeErrorText,
          tone === 'success' && styles.noticeSuccessText,
        ]}>
        {title}
      </Text>
      <Text
        style={[
          styles.noticeMessage,
          tone === 'error' && styles.noticeErrorText,
          tone === 'success' && styles.noticeSuccessText,
        ]}>
        {message}
      </Text>
      {action}
    </View>
  );
}

export function AdminLoading({ message = 'Loading...' }: { message?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={adminColors.blue} />
      <Text style={styles.loadingText}>{message}</Text>
    </View>
  );
}

export function AdminBadge({
  label,
  tone = 'muted',
}: {
  label: string;
  tone?: 'green' | 'amber' | 'red' | 'muted';
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
          tone === 'green' && styles.badgeGreenText,
          tone === 'amber' && styles.badgeAmberText,
          tone === 'red' && styles.badgeRedText,
        ]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: adminColors.paper,
  },
  pageContent: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: 18,
    paddingBottom: 30,
    gap: 14,
  },
  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 3,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    color: adminColors.blue,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 5,
  },
  title: {
    color: adminColors.navy,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: adminColors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  card: {
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: adminColors.line,
    backgroundColor: adminColors.white,
    shadowColor: '#1C2A3A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.035,
    shadowRadius: 8,
    elevation: 1,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    color: adminColors.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: adminColors.line,
    backgroundColor: '#FAFBFD',
    color: adminColors.ink,
    fontSize: 14,
  },
  multilineInput: {
    minHeight: 90,
    paddingVertical: 11,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: adminColors.red,
  },
  fieldError: {
    color: adminColors.red,
    fontSize: 10,
    lineHeight: 14,
  },
  selectButton: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: adminColors.line,
    backgroundColor: '#FAFBFD',
  },
  selectText: {
    color: adminColors.ink,
    fontSize: 13,
  },
  selectPlaceholder: {
    color: adminColors.muted,
  },
  selectChevron: {
    color: adminColors.muted,
    fontSize: 20,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#00000055',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  selectSheet: {
    maxHeight: '72%',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 26,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: adminColors.white,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    alignSelf: 'center',
    borderRadius: 2,
    backgroundColor: '#D4D9E1',
    marginBottom: 14,
  },
  sheetTitle: {
    color: adminColors.navy,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  optionRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F7',
  },
  optionRowSelected: {
    backgroundColor: '#F0F3FF',
  },
  optionText: {
    color: adminColors.ink,
    fontSize: 13,
  },
  optionTextSelected: {
    color: adminColors.blue,
    fontWeight: '700',
  },
  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 15,
    borderRadius: 11,
  },
  buttonPrimary: {
    backgroundColor: adminColors.navy,
  },
  buttonSecondary: {
    borderWidth: 1,
    borderColor: adminColors.line,
    backgroundColor: adminColors.white,
  },
  buttonDanger: {
    backgroundColor: adminColors.red,
  },
  buttonCompact: {
    minHeight: 36,
    paddingHorizontal: 11,
    borderRadius: 9,
  },
  buttonText: {
    color: adminColors.navy,
    fontSize: 12,
    fontWeight: '700',
  },
  buttonTextLight: {
    color: adminColors.white,
  },
  buttonTextCompact: {
    fontSize: 11,
  },
  buttonPressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.55,
  },
  notice: {
    padding: 13,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
  },
  noticeError: {
    backgroundColor: '#FFF3F3',
  },
  noticeSuccess: {
    backgroundColor: '#EAF7F1',
  },
  noticeTitle: {
    color: adminColors.navy,
    fontSize: 12,
    fontWeight: '800',
  },
  noticeMessage: {
    color: adminColors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  noticeErrorText: {
    color: adminColors.red,
  },
  noticeSuccessText: {
    color: adminColors.green,
  },
  loading: {
    minHeight: 110,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: adminColors.muted,
    fontSize: 12,
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9,
    backgroundColor: '#EEF1F5',
  },
  badgeGreen: {
    backgroundColor: '#E7F5EF',
  },
  badgeAmber: {
    backgroundColor: '#FFF3DD',
  },
  badgeRed: {
    backgroundColor: '#FDEAEA',
  },
  badgeText: {
    color: adminColors.muted,
    fontSize: 9,
    fontWeight: '800',
  },
  badgeGreenText: {
    color: adminColors.green,
  },
  badgeAmberText: {
    color: adminColors.amber,
  },
  badgeRedText: {
    color: adminColors.red,
  },
});
