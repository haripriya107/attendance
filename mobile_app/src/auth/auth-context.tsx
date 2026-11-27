import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, getCurrentUser, type AuthenticatedUser } from '@/config/api';

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'error';

type AuthContextValue = {
  error: string;
  refreshSession: () => Promise<void>;
  setUser: (user: AuthenticatedUser | null) => void;
  status: AuthStatus;
  user: AuthenticatedUser | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUserState] = useState<AuthenticatedUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [error, setError] = useState('');

  const setUser = useCallback((nextUser: AuthenticatedUser | null) => {
    setUserState(nextUser);
    setStatus(nextUser ? 'authenticated' : 'anonymous');
    setError('');
  }, []);

  const refreshSession = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      setUser(await getCurrentUser({ timeoutMs: 5000, retries: 0 }));
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 401) {
        setUser(null);
        return;
      }
      setStatus('error');
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to verify your Flask session.'
      );
    }
  }, [setUser]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  return (
    <AuthContext.Provider value={{ error, refreshSession, setUser, status, user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return context;
}

export function AuthLoadingScreen({ message = 'Checking your session...' }: { message?: string }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>OA</Text>
        </View>
        <ActivityIndicator color={styles.indicator.color} size="large" />
        <Text style={styles.message}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F3F6FA',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: 24,
  },
  logo: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#101B33',
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  indicator: {
    color: '#4667E8',
  },
  message: {
    color: '#78839A',
    fontSize: 14,
    textAlign: 'center',
  },
});
