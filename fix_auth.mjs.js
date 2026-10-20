import fs from 'fs';
import path from 'path';

const candidates = [
  path.resolve(process.cwd(), 'App.jsx'),
  path.resolve(process.cwd(), 'src', 'App.jsx'),
];

const targetPath = candidates.find(p => fs.existsSync(p));
if (!targetPath) {
  console.error('❌ Could not find App.jsx!');
  process.exit(1);
}

let code = fs.readFileSync(targetPath, 'utf8');
const hasCRLF = code.includes('\r\n');
if (hasCRLF) code = code.replace(/\r\n/g, '\n');

fs.writeFileSync(targetPath + '.bak', hasCRLF ? code.replace(/\n/g, '\r\n') : code, 'utf8');
console.log('📦 Backup saved to App.jsx.bak');

// 1. Fix ensureFreshToken(force = false) and auto-redirect to login on dead refresh token
const oldEnsure = `async function ensureFreshToken() {
  if (!currentRefreshToken) return currentAccessToken;
  // Only actually hit Supabase when within 60s of real expiry (or expiry is
  // unknown) -- NOT on every call. A single sync cycle fires 20+ requests
  // via Promise.all; refreshing unconditionally on every one of them floods
  // Supabase's auth endpoint and gets rate-limited (429 Too Many Requests),
  // which is exactly what happened before this fix.
  const needsRefresh = !currentTokenExpiresAt || Date.now() >= currentTokenExpiresAt - 60000;
  if (!needsRefresh) return currentAccessToken;
  // If a refresh is already underway, share it rather than firing a second
  // one -- otherwise every one of those 20+ concurrent calls would each
  // kick off its own refresh the moment the token actually expires.
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const data = await supabaseRefreshToken(currentRefreshToken);
        setAuthSession(data.access_token, data.refresh_token, data.expires_in);
        if (onTokenRefreshed) onTokenRefreshed(data.access_token, data.refresh_token, data.expires_in);
      } catch (e) {
        // refresh failed (e.g. refresh token itself expired) -- caller will get a
        // 401 from Supabase and the UI can prompt the person to sign in again
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  await refreshInFlight;
  return currentAccessToken;
}`;

const newEnsure = `let onAuthExpired = null;
async function ensureFreshToken(force = false) {
  if (!currentRefreshToken) {
    if (force && onAuthExpired) onAuthExpired();
    return currentAccessToken;
  }
  // Refresh 5 minutes before expiry OR immediately when force=true (on a 401 response)
  const needsRefresh = force || !currentTokenExpiresAt || Date.now() >= currentTokenExpiresAt - 300000;
  if (!needsRefresh) return currentAccessToken;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const data = await supabaseRefreshToken(currentRefreshToken);
        setAuthSession(data.access_token, data.refresh_token, data.expires_in);
        try {
          const raw = localStorage.getItem('ctpm:user_identity');
          if (raw) {
            const u = JSON.parse(raw);
            localStorage.setItem('ctpm:user_identity', JSON.stringify({
              ...u,
              accessToken: data.access_token,
              refreshToken: data.refresh_token,
              expiresAt: Date.now() + ((Number(data.expires_in) || 3600) * 1000),
            }));
          }
        } catch {}
        if (onTokenRefreshed) onTokenRefreshed(data.access_token, data.refresh_token, data.expires_in);
      } catch (e) {
        console.warn('Session expired, redirecting to login screen:', e);
        setAuthSession(null, null, 0);
        try { localStorage.removeItem('ctpm:user_identity'); } catch {}
        if (onAuthExpired) onAuthExpired();
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  await refreshInFlight;
  return currentAccessToken;
}`;

if (code.includes('async function ensureFreshToken()')) {
  code = code.replace(oldEnsure, newEnsure);
  console.log('✅ Patched ensureFreshToken() to honor forced refreshes, persist tokens & auto-logout on dead sessions.');
}

// 2. Wire onAuthExpired in App component or fallback reload so 401s immediately show the Login screen
const bulkCheckTarget = `  if (!res.ok) throw new Error(\`bulk read failed (\${res.status})\`);`;
const bulkCheckReplacement = `  if (res.status === 401) {
    try { localStorage.removeItem('ctpm:user_identity'); } catch {}
    window.location.reload();
    throw new Error('Session expired — reloading to sign in');
  }
  if (!res.ok) throw new Error(\`bulk read failed (\${res.status})\`);`;

if (code.includes(bulkCheckTarget) && !code.includes('Session expired — reloading to sign in')) {
  code = code.replace(bulkCheckTarget, bulkCheckReplacement);
  console.log('✅ Patched bulk loader to automatically clear expired session and show Login screen on 401.');
}

const singleCheckTarget = `  if (!res.ok) throw new Error(\`read failed (\${res.status})\`);`;
const singleCheckReplacement = `  if (res.status === 401) {
    try { localStorage.removeItem('ctpm:user_identity'); } catch {}
    window.location.reload();
    throw new Error('Session expired — reloading to sign in');
  }
  if (!res.ok) throw new Error(\`read failed (\${res.status})\`);`;

if (code.includes(singleCheckTarget)) {
  code = code.replace(singleCheckTarget, singleCheckReplacement);
  console.log('✅ Patched single key loader to automatically clear expired session and show Login screen on 401.');
}

fs.writeFileSync(targetPath, hasCRLF ? code.replace(/\n/g, '\r\n') : code, 'utf8');
console.log('\n🎉 Auth permanence fix applied in 1 second!');