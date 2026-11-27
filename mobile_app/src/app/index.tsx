import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthLoadingScreen, useAuth } from '@/auth/auth-context';
import {
  changeEmployeePassword,
  signIn,
  signOut,
  type AuthenticatedUser,
  type UserRole,
} from '@/config/api';

type FormErrors = {
  email?: string;
  password?: string;
};

const colors = {
  navy: '#142C4C',
  navyDark: '#0E2038',
  accent: '#2F6B9A',
  background: '#F3F6FA',
  surface: '#FFFFFF',
  field: '#F8FAFC',
  border: '#E1E7EF',
  text: '#1C2A3A',
  muted: '#718096',
  error: '#B42318',
  white: '#FFFFFF',
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

function roleLabel(role: UserRole) {
  return role === 'admin' ? 'Admin' : 'Employee';
}

export default function HomeScreen() {
  const router = useRouter();
  const {
    error: sessionError,
    refreshSession,
    setUser: setSessionUser,
    status: authStatus,
    user: sessionUser,
  } = useAuth();
  const [role, setRole] = useState<UserRole>('employee');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [apiError, setApiError] = useState('');
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const passwordInput = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (authStatus === 'authenticated' && sessionUser) {
      setRole(sessionUser.role);
      if (sessionUser.must_change_password) {
        setAuthenticatedUser(sessionUser);
      } else {
        router.replace(sessionUser.role === 'admin' ? '/admin' : '/employee');
      }
    } else if (authStatus === 'anonymous') {
      setAuthenticatedUser(null);
    }
  }, [authStatus, router, sessionUser]);

  if (authStatus === 'loading') {
    return <AuthLoadingScreen />;
  }

  const handleSignIn = async () => {
    if (isSigningIn) {
      return;
    }

    const nextErrors: FormErrors = {};
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      nextErrors.email = 'Enter your email address.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      nextErrors.email = 'Enter a valid email address.';
    }

    if (!password) {
      nextErrors.password = 'Enter your password.';
    }

    setErrors(nextErrors);
    setApiError('');
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSigningIn(true);
    try {
      const user = await signIn(normalizedEmail, password);
      setAuthenticatedUser(user);
      setSessionUser(user);
      setRole(user.role);
      if (!user.must_change_password) {
        setPassword('');
      }
    } catch (error) {
      setApiError(errorMessage(error));
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleChangePassword = async () => {
    if (!password) {
      setPasswordChangeError('Enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordChangeError('Your new password must contain at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError('The new passwords do not match.');
      return;
    }
    if (newPassword === password) {
      setPasswordChangeError('Choose a password different from your temporary password.');
      return;
    }

    setPasswordChangeError('');
    setIsChangingPassword(true);
    try {
      const user = await changeEmployeePassword(password, newPassword);
      setAuthenticatedUser(user);
      setSessionUser(user);
      setPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (error) {
      setPasswordChangeError(errorMessage(error));
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleSignOut = async () => {
    setApiError('');
    setIsSigningOut(true);
    try {
      await signOut();
      setSessionUser(null);
      setAuthenticatedUser(null);
      setPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordChangeError('');
      router.replace('/');
    } catch (error) {
      setApiError(errorMessage(error));
    } finally {
      setIsSigningOut(false);
    }
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Password reset',
      'Password reset is not available from this screen. Contact your administrator for help.'
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}>
          <View style={styles.content}>
            <View style={styles.brandRow}>
              <View style={styles.logoMark}>
                <Text style={styles.logoText}>OA</Text>
              </View>
              <View>
                <Text style={styles.brandName}>Office Attendance</Text>
                <Text style={styles.brandCaption}>MANAGEMENT PORTAL</Text>
              </View>
            </View>

            <View style={styles.intro}>
              <Text style={styles.welcome}>
                {authenticatedUser?.must_change_password
                  ? 'Update your password'
                  : authenticatedUser
                    ? "You're signed in"
                    : 'Welcome Back'}
              </Text>
              <Text style={styles.subtitle}>
                {authenticatedUser?.must_change_password
                  ? 'Your temporary password must be changed before continuing.'
                  : authenticatedUser
                    ? 'Your account session is active and verified.'
                    : 'Sign in to continue to your account.'}
              </Text>
            </View>

            <View style={styles.card}>
              {authenticatedUser ? (
                authenticatedUser.must_change_password ? (
                  <>
                    <View style={styles.accountSummary}>
                      <Text style={styles.accountName}>{authenticatedUser.name}</Text>
                      <Text style={styles.accountDetails}>
                        {authenticatedUser.email} · {roleLabel(authenticatedUser.role)}
                      </Text>
                    </View>
                    <Text style={styles.changePasswordHint}>
                      Enter your current password and choose a new password with at least 8
                      characters.
                    </Text>

                    <View style={styles.inputGroup}>
                      <Text style={styles.fieldLabel}>Current password</Text>
                      <View style={styles.passwordField}>
                        <TextInput
                          accessibilityLabel="Current password"
                          autoCapitalize="none"
                          autoComplete="current-password"
                          onChangeText={setPassword}
                          placeholder="Enter your current password"
                          placeholderTextColor={colors.muted}
                          secureTextEntry={!passwordVisible}
                          selectionColor={colors.accent}
                          style={styles.passwordInput}
                          textContentType="password"
                          value={password}
                        />
                        <Pressable
                          accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                          accessibilityRole="button"
                          onPress={() => setPasswordVisible((visible) => !visible)}
                          hitSlop={8}
                          style={styles.visibilityButton}>
                          <Text style={styles.visibilityText}>
                            {passwordVisible ? 'Hide' : 'Show'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>

                    {apiError ? (
                      <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                        {apiError}
                      </Text>
                    ) : null}

                    <View style={styles.inputGroup}>
                      <Text style={styles.fieldLabel}>New password</Text>
                      <TextInput
                        accessibilityLabel="New password"
                        autoCapitalize="none"
                        autoComplete="new-password"
                        onChangeText={setNewPassword}
                        placeholder="At least 8 characters"
                        placeholderTextColor={colors.muted}
                        secureTextEntry
                        selectionColor={colors.accent}
                        style={styles.textInput}
                        textContentType="newPassword"
                        value={newPassword}
                      />
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.fieldLabel}>Confirm new password</Text>
                      <TextInput
                        accessibilityLabel="Confirm new password"
                        autoCapitalize="none"
                        autoComplete="new-password"
                        onChangeText={setConfirmNewPassword}
                        onSubmitEditing={() => void handleChangePassword()}
                        placeholder="Re-enter your new password"
                        placeholderTextColor={colors.muted}
                        returnKeyType="done"
                        secureTextEntry
                        selectionColor={colors.accent}
                        style={styles.textInput}
                        textContentType="newPassword"
                        value={confirmNewPassword}
                      />
                    </View>

                    {passwordChangeError ? (
                      <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                        {passwordChangeError}
                      </Text>
                    ) : null}

                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isChangingPassword }}
                      disabled={isChangingPassword}
                      onPress={() => void handleChangePassword()}
                      style={({ pressed }) => [
                        styles.signInButton,
                        pressed && !isChangingPassword && styles.signInButtonPressed,
                        isChangingPassword && styles.buttonDisabled,
                      ]}>
                      {isChangingPassword ? (
                        <ActivityIndicator color={colors.white} />
                      ) : (
                        <Text style={styles.signInText}>Update Password</Text>
                      )}
                    </Pressable>

                    <Pressable
                      accessibilityRole="button"
                      disabled={isSigningOut}
                      onPress={() => void handleSignOut()}
                      style={({ pressed }) => [
                        styles.secondaryButton,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={styles.secondaryButtonText}>
                        {isSigningOut ? 'Signing out...' : 'Sign Out'}
                      </Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.signedInMark}>
                      <Text style={styles.signedInMarkText}>OK</Text>
                    </View>
                    <Text style={styles.signedInTitle}>Signed in successfully</Text>
                    <Text style={styles.accountName}>{authenticatedUser.name}</Text>
                    <Text style={styles.accountDetails}>
                      {authenticatedUser.email} · {roleLabel(authenticatedUser.role)}
                    </Text>
                    <Text style={styles.securityNote}>
                      Your role comes from your Flask account, not the role selector.
                    </Text>

                    {apiError ? (
                      <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                        {apiError}
                      </Text>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isSigningOut }}
                      disabled={isSigningOut}
                      onPress={() => void handleSignOut()}
                      style={({ pressed }) => [
                        styles.signInButton,
                        pressed && !isSigningOut && styles.signInButtonPressed,
                        isSigningOut && styles.buttonDisabled,
                      ]}>
                      {isSigningOut ? (
                        <ActivityIndicator color={colors.white} />
                      ) : (
                        <Text style={styles.signInText}>Sign Out</Text>
                      )}
                    </Pressable>
                  </>
                )
              ) : (
                <>
                  <Text style={styles.fieldLabel}>Sign in as</Text>
                  <View style={styles.roleSelector} accessibilityRole="radiogroup">
                    {(['employee', 'admin'] as const).map((option) => {
                      const selected = role === option;
                      const label = roleLabel(option);

                      return (
                        <Pressable
                          key={option}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          onPress={() => setRole(option)}
                          style={({ pressed }) => [
                            styles.roleOption,
                            selected && styles.roleOptionSelected,
                            pressed && styles.pressed,
                          ]}>
                          <Text
                            style={[
                              styles.roleOptionText,
                              selected && styles.roleOptionTextSelected,
                            ]}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.fieldLabel}>Email address</Text>
                    <TextInput
                      accessibilityLabel="Email address"
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      editable={!isSigningIn}
                      keyboardType="email-address"
                      onChangeText={(value) => {
                        setEmail(value);
                        if (errors.email) {
                          setErrors((current) => ({ ...current, email: undefined }));
                        }
                      }}
                      onSubmitEditing={() => passwordInput.current?.focus()}
                      placeholder="name@company.com"
                      placeholderTextColor={colors.muted}
                      returnKeyType="next"
                      selectionColor={colors.accent}
                      style={[styles.textInput, errors.email && styles.textInputError]}
                      textContentType="emailAddress"
                      value={email}
                    />
                    {errors.email ? <Text style={styles.errorText}>{errors.email}</Text> : null}
                  </View>

                  <View style={styles.inputGroup}>
                    <Text style={styles.fieldLabel}>Password</Text>
                    <View style={[styles.passwordField, errors.password && styles.textInputError]}>
                      <TextInput
                        ref={passwordInput}
                        accessibilityLabel="Password"
                        autoCapitalize="none"
                        autoComplete="password"
                        editable={!isSigningIn}
                        onChangeText={(value) => {
                          setPassword(value);
                          if (errors.password) {
                            setErrors((current) => ({ ...current, password: undefined }));
                          }
                        }}
                        onSubmitEditing={() => void handleSignIn()}
                        placeholder="Enter your password"
                        placeholderTextColor={colors.muted}
                        returnKeyType="done"
                        secureTextEntry={!passwordVisible}
                        selectionColor={colors.accent}
                        style={styles.passwordInput}
                        textContentType="password"
                        value={password}
                      />
                      <Pressable
                        accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                        accessibilityRole="button"
                        disabled={isSigningIn}
                        onPress={() => setPasswordVisible((visible) => !visible)}
                        hitSlop={8}
                        style={styles.visibilityButton}>
                        <Text style={styles.visibilityText}>
                          {passwordVisible ? 'Hide' : 'Show'}
                        </Text>
                      </Pressable>
                    </View>
                    {errors.password ? (
                      <Text style={styles.errorText}>{errors.password}</Text>
                    ) : null}
                  </View>

                  <Pressable
                    accessibilityRole="button"
                    disabled={isSigningIn}
                    onPress={handleForgotPassword}
                    style={({ pressed }) => [styles.forgotButton, pressed && styles.pressed]}>
                    <Text style={styles.forgotText}>Forgot Password?</Text>
                  </Pressable>

                  {apiError ? (
                    <Text accessibilityLiveRegion="polite" style={styles.errorText}>
                      {apiError}
                    </Text>
                  ) : null}
                  {sessionError ? (
                    <View accessibilityLiveRegion="polite" style={styles.sessionError}>
                      <Text style={styles.errorText}>{sessionError}</Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => void refreshSession()}
                        style={({ pressed }) => [styles.retrySession, pressed && styles.pressed]}>
                        <Text style={styles.retrySessionText}>Retry session check</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isSigningIn }}
                    disabled={isSigningIn}
                    onPress={() => void handleSignIn()}
                    style={({ pressed }) => [
                      styles.signInButton,
                      pressed && !isSigningIn && styles.signInButtonPressed,
                      isSigningIn && styles.buttonDisabled,
                    ]}>
                    {isSigningIn ? (
                      <View style={styles.loadingContent}>
                        <ActivityIndicator color={colors.white} />
                        <Text style={styles.signInText}>Signing In...</Text>
                      </View>
                    ) : (
                      <Text style={styles.signInText}>Sign In</Text>
                    )}
                  </Pressable>

                  <Text style={styles.securityNote}>
                    Secure access for your workplace account
                  </Text>
                </>
              )}
            </View>

            <Text style={styles.footerText}>Office Attendance Management System</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 22,
  },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 36,
  },
  logoMark: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navy,
    shadowColor: colors.navyDark,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  logoText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  brandName: {
    color: colors.navy,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  brandCaption: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 3,
  },
  intro: {
    marginBottom: 24,
  },
  welcome: {
    color: colors.navyDark,
    fontSize: 30,
    lineHeight: 37,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 7,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: 24,
    borderWidth: 1,
    borderColor: '#EDF1F5',
    shadowColor: '#20334A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 5,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 9,
  },
  roleSelector: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 13,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 23,
  },
  roleOption: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    borderRadius: 10,
  },
  roleOptionSelected: {
    backgroundColor: colors.navy,
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4,
    elevation: 2,
  },
  roleOptionText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  roleOptionTextSelected: {
    color: colors.white,
  },
  inputGroup: {
    marginBottom: 18,
  },
  textInput: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.field,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 15,
  },
  passwordField: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.field,
  },
  passwordInput: {
    flex: 1,
    minHeight: 50,
    color: colors.text,
    fontSize: 15,
    paddingLeft: 15,
    paddingRight: 8,
  },
  visibilityButton: {
    minHeight: 48,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  textInputError: {
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 12,
  },
  sessionError: {
    marginBottom: 8,
  },
  retrySession: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: colors.field,
  },
  retrySessionText: {
    color: colors.navy,
    fontSize: 11,
    fontWeight: '700',
  },
  forgotButton: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    marginTop: -4,
    marginBottom: 20,
  },
  forgotText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  signInButton: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: colors.navy,
    shadowColor: colors.navy,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  signInButtonPressed: {
    backgroundColor: colors.navyDark,
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  signInText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  loadingContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  securityNote: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 18,
  },
  accountSummary: {
    marginBottom: 18,
  },
  accountName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
  },
  accountDetails: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 5,
  },
  changePasswordHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 20,
  },
  signedInMark: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F2FA',
    marginBottom: 12,
  },
  signedInMarkText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: '800',
  },
  signedInTitle: {
    color: colors.navy,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: '600',
  },
  footerText: {
    color: colors.muted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
  },
  pressed: {
    opacity: 0.75,
  },
});
