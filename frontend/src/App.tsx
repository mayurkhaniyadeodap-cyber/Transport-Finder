import { useCallback, useEffect, useState } from "react";
import LoginPage, { Role } from "./pages/LoginPage";
import TransportFinder from "./pages/TransportFinder";
import { logout } from "./services/settingsApi";
import { clearSession, loadSession, saveSession, Session } from "./session";

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);

  // An older sign-in (role only, no session token) is dropped so it signs in again properly.
  useEffect(() => {
    if (!loadSession()) clearSession();
  }, []);

  const onLogin = (role: Role, token: string) => {
    saveSession({ role, token });
    setSession({ role, token });
  };

  const onLogout = useCallback(() => {
    const current = loadSession();
    if (current) logout(current.token);
    clearSession();
    setSession(null);
  }, []);

  if (!session) return <LoginPage onLogin={onLogin} />;
  return <TransportFinder role={session.role} token={session.token} onLogout={onLogout} />;
}
