import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { User, Mail, Shield, Building2, IdCard, Camera, Loader2, Phone, Briefcase, CalendarDays, UserRound } from 'lucide-react';
import { toast } from 'sonner';

const backendUrl = process.env.REACT_APP_BACKEND_URL || '';

const formatDate = (value) => {
  if (!value) return 'Not available';
  const datePart = String(value).slice(0, 10);
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return value;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const displayValue = (value) => {
  const text = String(value || '').trim();
  return text || 'Not available';
};

const profilePictureSrc = (picture) => {
  if (!picture) return null;
  if (/^https?:\/\//i.test(picture)) return picture;
  if (picture.startsWith('/')) return `${backendUrl}${picture}`;
  return `${backendUrl}/api/auth/profile/picture/${picture}`;
};

const ReadOnlyField = ({ label, value, icon: Icon, testId }) => (
  <div>
    <label className="block text-xs font-medium text-foreground-muted mb-1.5 tracking-wide">{label}</label>
    <div className="relative">
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" size={16} />
      <div
        data-testid={testId}
        className="min-h-[42px] w-full rounded-lg border border-border/50 bg-secondary/50 py-2.5 pl-10 pr-4 text-sm text-foreground"
      >
        {displayValue(value)}
      </div>
    </div>
  </div>
);

const Profile = () => {
  const { user, token, setUser } = useAuth();
  const fileInputRef = useRef(null);
  const [uploadingPic, setUploadingPic] = useState(false);
  const [profileData, setProfileData] = useState(null);

  useEffect(() => {
    let active = true;

    const fetchProfile = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok && active) {
          setProfileData(data.user);
          setUser(data.user);
        }
      } catch {
        // Keep the profile page usable with the session snapshot.
      }
    };

    fetchProfile();
    return () => { active = false; };
  }, [token, setUser]);

  const handlePictureUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPic(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${backendUrl}/api/auth/profile/picture`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        setProfileData((prev) => ({ ...(prev || user), profile_picture: data.picture_url }));
        setUser((prev) => ({ ...(prev || user), profile_picture: data.picture_url }));
        toast.success('Profile picture updated');
      } else {
        toast.error(data.detail || 'Upload failed');
      }
    } catch {
      toast.error('Failed to upload picture');
    } finally {
      setUploadingPic(false);
    }
  };

  const p = profileData || user;
  const avatarSrc = profilePictureSrc(p?.profile_picture);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 lg:p-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h1 className="text-2xl font-heading font-bold text-foreground mb-1" data-testid="profile-title">Profile</h1>
            <p className="text-sm text-foreground-muted mb-8">HRMS employee profile</p>

            <div className="glass-card rounded-xl p-6 mb-6">
              <div className="flex items-center gap-5">
                <div className="relative group">
                  <div className="w-20 h-20 rounded-full bg-secondary flex items-center justify-center overflow-hidden border-2 border-border">
                    {avatarSrc ? (
                      <img
                        src={avatarSrc}
                        alt="Profile"
                        className="w-full h-full object-cover"
                        data-testid="profile-picture-img"
                      />
                    ) : (
                      <User size={36} className="text-foreground-muted" />
                    )}
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingPic}
                    data-testid="upload-picture-button"
                    className="absolute -bottom-1 -right-1 p-1.5 bg-primary rounded-full text-primary-foreground hover:bg-primary-hover transition-colors shadow-lg"
                    aria-label="Upload profile picture"
                  >
                    {uploadingPic ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePictureUpload} className="hidden" data-testid="picture-file-input" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-xl font-heading font-bold text-foreground truncate">{p?.name}</h2>
                  <p className="text-sm text-foreground-muted truncate">{p?.ethara_email || p?.email}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={`inline-block px-2.5 py-0.5 text-[11px] font-medium rounded-md capitalize ${
                      p?.role === 'admin' ? 'bg-primary/15 text-primary border border-primary/30' :
                      p?.role === 'hr' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                      'bg-[rgba(144,141,206,0.15)] text-accent border border-accent/20'
                    }`}>
                      {p?.role === 'hr' ? 'HR' : p?.role}
                    </span>
                    {p?.company_id && (
                      <span className="inline-block rounded-md border border-border/60 px-2.5 py-0.5 text-[11px] font-medium text-foreground-muted">
                        {p.company_id}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card rounded-xl p-6 mb-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-foreground">HRMS Profile</h3>
                {p?.hrms_synced_at && (
                  <span className="rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                    Synced
                  </span>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <ReadOnlyField label="OFFICIAL EMAIL" value={p?.ethara_email || p?.email} icon={Mail} testId="profile-email" />
                <ReadOnlyField label="PERSONAL EMAIL" value={p?.personal_email} icon={Mail} testId="profile-personal-email" />
                <ReadOnlyField label="ROLE" value={p?.role === 'hr' ? 'HR' : p?.role} icon={Shield} testId="profile-role" />
                <ReadOnlyField label="EMPLOYEE CODE" value={p?.company_id} icon={IdCard} testId="profile-company-id" />
                <ReadOnlyField label="DEPARTMENT" value={p?.department} icon={Building2} testId="profile-department" />
                <ReadOnlyField label="DESIGNATION" value={p?.designation} icon={Briefcase} testId="profile-designation" />
                <ReadOnlyField label="PHONE" value={p?.phone} icon={Phone} testId="profile-phone" />
                <ReadOnlyField label="GENDER" value={p?.gender} icon={UserRound} testId="profile-gender" />
                <ReadOnlyField label="DATE OF BIRTH" value={formatDate(p?.dob)} icon={CalendarDays} testId="profile-dob" />
                <ReadOnlyField label="DATE OF JOINING" value={formatDate(p?.company_doj)} icon={CalendarDays} testId="profile-doj" />
              </div>
            </div>

            <div className="glass-card rounded-xl p-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Account Information</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="bg-secondary/40 rounded-lg p-3">
                  <p className="text-[11px] text-foreground-muted mb-0.5">Member Since</p>
                  <p className="text-sm text-foreground">{p?.created_at ? formatDate(p.created_at) : 'N/A'}</p>
                </div>
                <div className="bg-secondary/40 rounded-lg p-3">
                  <p className="text-[11px] text-foreground-muted mb-0.5">Permissions</p>
                  <p className="text-sm text-foreground">
                    {p?.role === 'admin' ? 'Full Access' : p?.role === 'hr' ? 'HR Access' : 'View Only'}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default Profile;
