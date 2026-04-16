import { useEffect, useState } from "react";
import { getToken } from "../App";
import { useToast } from "../components/AppFeedback";

const apiBase = import.meta.env.VITE_API_URL || "";

function authHeaders() {
  return { Authorization: `Bearer ${getToken()}` };
}

export default function Settings() {
  const toast = useToast();
  const [profile, setProfile] = useState({ username: "", displayName: "", email: "", createdAt: "" });
  const [profileForm, setProfileForm] = useState({ displayName: "", email: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", nextPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadProfile() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${apiBase}/api/profile`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) {
          setError(data.message || "Could not load your settings.");
          return;
        }
        setProfile(data.profile);
        setProfileForm({
          displayName: data.profile.displayName || "",
          email: data.profile.email || "",
        });
      } catch {
        setError("Could not reach the server.");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, []);

  function handleProfileChange(event) {
    const { name, value } = event.target;
    setProfileForm((current) => ({ ...current, [name]: value }));
  }

  function handlePasswordChange(event) {
    const { name, value } = event.target;
    setPasswordForm((current) => ({ ...current, [name]: value }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    setProfileSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/profile`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(profileForm),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Could not update your profile.");
        return;
      }
      setProfile(data.profile);
      setProfileForm({
        displayName: data.profile.displayName || "",
        email: data.profile.email || "",
      });
      toast.success("Your profile details are up to date.", "Profile updated");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function savePassword(event) {
    event.preventDefault();
    if (passwordForm.nextPassword !== passwordForm.confirmPassword) {
      toast.error("New password and confirmation must match.");
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await fetch(`${apiBase}/api/profile/password`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          nextPassword: passwordForm.nextPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || "Could not update your password.");
        return;
      }
      setPasswordForm({ currentPassword: "", nextPassword: "", confirmPassword: "" });
      toast.success("Your password was updated.", "Security updated");
    } catch {
      toast.error("Could not reach the server.");
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <main className="app-shell workspace-shell">
      <section className="card workspace-header settings-hero">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 className="page-title">Personalize your workspace</h1>
          <p className="lead">
            Keep your account details current and make the workspace feel a little more like your own.
          </p>
        </div>
        <div className="quality-metrics workspace-metrics">
          <div>
            <span className="meta-label">Username</span>
            <strong>{profile.username || "Loading"}</strong>
          </div>
          <div>
            <span className="meta-label">Display name</span>
            <strong>{profile.displayName || "Not set"}</strong>
          </div>
          <div>
            <span className="meta-label">Email</span>
            <strong>{profile.email || "Not set"}</strong>
          </div>
          <div>
            <span className="meta-label">Joined</span>
            <strong>{profile.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "n/a"}</strong>
          </div>
        </div>
      </section>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="settings-grid">
        <article className="card settings-panel">
          <p className="eyebrow">Profile</p>
          <h2>Account details</h2>
          <p className="muted">Use a display name and contact email so shared reports feel more professional.</p>
          <form onSubmit={saveProfile} noValidate>
            <label className="field">
              <span>Display name</span>
              <input
                type="text"
                name="displayName"
                value={profileForm.displayName}
                onChange={handleProfileChange}
                disabled={loading}
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                name="email"
                value={profileForm.email}
                onChange={handleProfileChange}
                disabled={loading}
              />
            </label>
            <button className="btn btn-primary" disabled={loading || profileSaving}>
              {profileSaving ? "Saving…" : "Save profile"}
            </button>
          </form>
        </article>

        <article className="card settings-panel">
          <p className="eyebrow">Security</p>
          <h2>Change password</h2>
          <p className="muted">Keep the workspace usable on shared machines by rotating your password when needed.</p>
          <form onSubmit={savePassword} noValidate>
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                name="currentPassword"
                value={passwordForm.currentPassword}
                onChange={handlePasswordChange}
              />
            </label>
            <label className="field">
              <span>New password</span>
              <input
                type="password"
                name="nextPassword"
                value={passwordForm.nextPassword}
                onChange={handlePasswordChange}
              />
            </label>
            <label className="field">
              <span>Confirm new password</span>
              <input
                type="password"
                name="confirmPassword"
                value={passwordForm.confirmPassword}
                onChange={handlePasswordChange}
              />
            </label>
            <button className="btn btn-primary" disabled={passwordSaving}>
              {passwordSaving ? "Updating…" : "Update password"}
            </button>
          </form>
        </article>
      </section>
    </main>
  );
}
