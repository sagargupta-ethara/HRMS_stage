import React, { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext();
const WIKI_TOKEN_STORAGE_KEY = 'ethara_wiki_token';
const HRMS_TOKEN_STORAGE_KEY = 'ethara_access_token';
const backendUrl = process.env.REACT_APP_BACKEND_URL || '';

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(sessionStorage.getItem(WIKI_TOKEN_STORAGE_KEY));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const isLoopbackHost = ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);

    const bootstrapSession = async () => {
      const hrmsToken = sessionStorage.getItem(HRMS_TOKEN_STORAGE_KEY);

      if (hrmsToken) {
        try {
          const response = await fetch(`${backendUrl}/api/auth/hrms-session`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${hrmsToken}`
            }
          });

          if (!response.ok) {
            throw new Error('Invalid HRMS session');
          }

          const data = await response.json();
          sessionStorage.setItem(WIKI_TOKEN_STORAGE_KEY, data.token);

          if (!cancelled) {
            setToken(data.token);
            setUser(data.user);
            setLoading(false);
          }
          return;
        } catch (error) {
          sessionStorage.removeItem(WIKI_TOKEN_STORAGE_KEY);
          if (!cancelled) {
            setToken(null);
            setUser(null);
          }
        }
      }

      if (token) {
        try {
          const response = await fetch(`${backendUrl}/api/auth/me`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (!response.ok) {
            throw new Error('Invalid session');
          }

          const data = await response.json();
          if (!cancelled) {
            setUser(data.user);
            setLoading(false);
          }
          return;
        } catch (error) {
          sessionStorage.removeItem(WIKI_TOKEN_STORAGE_KEY);
          if (!cancelled) {
            setUser(null);
          }
        }
      }

      try {
        let response = null;

        if ((!response || !response.ok) && isLoopbackHost) {
          response = await fetch(`${backendUrl}/api/auth/local-session`, {
            method: 'POST'
          });
        }

        if (!response || !response.ok) {
          throw new Error('Failed to start employee wiki session');
        }

        const data = await response.json();
        sessionStorage.setItem(WIKI_TOKEN_STORAGE_KEY, data.token);

        if (!cancelled) {
          setToken(data.token);
          setUser(data.user);
        }
      } catch (error) {
        sessionStorage.removeItem(WIKI_TOKEN_STORAGE_KEY);
        if (!cancelled) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    bootstrapSession();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = (newToken, userData) => {
    sessionStorage.setItem(WIKI_TOKEN_STORAGE_KEY, newToken);
    setToken(newToken);
    setUser(userData);
  };

  const logout = () => {
    sessionStorage.removeItem(WIKI_TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  };

  const hasRole = (roles) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, hasRole, setUser }}>
      {children}
    </AuthContext.Provider>
  );
};
