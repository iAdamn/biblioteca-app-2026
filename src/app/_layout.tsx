import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { migrateDbIfNeeded } from '@/db/migrations';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { DataProvider } from '@/providers/data-provider';
export { ErrorBoundary } from 'expo-router';

void SplashScreen.preventAutoHideAsync();
function Navigation() {
  const { status } = useAuth();
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={status === 'signedOut'}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" options={{ headerShown: true, title: 'Crear cuenta' }} />
    </Stack.Protected>
    <Stack.Protected guard={status === 'signedIn'}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="book/[id]" options={{ headerShown: true, title: 'Detalle del libro' }} />
    </Stack.Protected>
  </Stack>;
}
function SessionContent() {
  const { status, user } = useAuth();
  useEffect(() => { if (status !== 'loading') void SplashScreen.hideAsync(); }, [status]);
  if (status === 'loading') return null;
  if (!user) return <Navigation />;
  const key = `${encodeURIComponent(user.uid)}-${user.role}`;
  return <SQLiteProvider key={key} databaseName={`biblioteca-${key}.db`} onInit={migrateDbIfNeeded}>
    <DataProvider><Navigation /></DataProvider>
  </SQLiteProvider>;
}
export default function RootLayout() {
  const scheme = useColorScheme();
  return <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
    <StatusBar style="auto" />
    <AuthProvider><SessionContent /></AuthProvider>
  </ThemeProvider>;
}
