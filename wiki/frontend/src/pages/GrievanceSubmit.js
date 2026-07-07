import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { MessageSquareWarning, Send, Eye, EyeOff, CheckCircle, Clock, AlertCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

const GrievanceSubmit = () => {
  const { token, user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [myGrievances, setMyGrievances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({ category: '', description: '', is_anonymous: false });

  useEffect(() => { fetchCategories(); fetchMyGrievances(); }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/grievances/categories`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (error) { console.error('fetch failed:', error); }
  };

  const fetchMyGrievances = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/grievances/my`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await response.json();
      setMyGrievances(data.grievances || []);
    } catch (error) { console.error('fetch failed:', error); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.category || !formData.description.trim()) { toast.error('Please fill in all required fields'); return; }
    setSubmitting(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/grievances`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      if (response.ok) {
        toast.success('Grievance submitted successfully');
        setFormData({ category: '', description: '', is_anonymous: false });
        fetchMyGrievances();
      } else {
        const data = await response.json();
        toast.error(data.detail || 'Failed to submit grievance');
      }
    } catch (error) { toast.error('Failed to submit grievance'); }
    finally { setSubmitting(false); }
  };

  const getStatusBadge = (status) => {
    const cfg = {
      pending: { icon: Clock, cls: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Pending' },
      in_review: { icon: AlertCircle, cls: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'In Review' },
      addressed: { icon: CheckCircle, cls: 'text-green-400 bg-green-500/10 border-green-500/20', label: 'Addressed' }
    };
    const c = cfg[status] || cfg.pending;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-full border font-medium ${c.cls}`}>
        <c.icon size={11} />{c.label}
      </span>
    );
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-6 lg:p-10">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            {/* Header */}
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <MessageSquareWarning size={24} className="text-amber-400" />
              </div>
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground">Grievance Portal</h1>
                <p className="text-sm text-foreground-muted">Submit your concerns confidentially</p>
              </div>
            </div>

            {/* Form */}
            <div className="glass-card rounded-xl p-6 mb-8">
              <h2 className="text-base font-semibold text-foreground mb-5 flex items-center gap-2">
                <ShieldCheck size={16} className="text-primary" />
                Submit a Grievance
              </h2>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-xs font-medium text-foreground-muted mb-1.5 tracking-wide">
                    CATEGORY <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-2.5 bg-secondary border border-border rounded-lg text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all appearance-none cursor-pointer"
                    data-testid="grievance-category-select"
                  >
                    <option value="">Select a category</option>
                    {categories.map((cat) => (<option key={cat} value={cat}>{cat}</option>))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground-muted mb-1.5 tracking-wide">
                    DESCRIPTION <span className="text-red-400">*</span>
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe your concern in detail..."
                    className="w-full px-4 py-3 bg-secondary border border-border rounded-lg text-foreground text-sm placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all resize-none"
                    rows={5}
                    data-testid="grievance-description-input"
                  />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, is_anonymous: !formData.is_anonymous })}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
                      formData.is_anonymous
                        ? 'bg-primary/10 text-primary border-primary/30 shadow-[0_0_12px_rgba(237,0,237,0.12)]'
                        : 'bg-transparent text-foreground-muted border-border hover:border-accent/40 hover:text-foreground'
                    }`}
                    data-testid="anonymous-toggle"
                  >
                    {formData.is_anonymous ? <EyeOff size={16} /> : <Eye size={16} />}
                    <span>{formData.is_anonymous ? 'Anonymous' : 'With my name'}</span>
                  </button>

                  <button
                    type="submit"
                    disabled={submitting || !formData.category || !formData.description.trim()}
                    className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary-hover transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-glow"
                    data-testid="submit-grievance-button"
                  >
                    <Send size={16} />
                    <span>{submitting ? 'Submitting...' : 'Submit'}</span>
                  </button>
                </div>

                <AnimatePresence>
                  {formData.is_anonymous && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-xs text-accent bg-[rgba(144,141,206,0.08)] border border-accent/20 px-3 py-2 rounded-lg overflow-hidden"
                    >
                      Your identity will be kept confidential. HR will not see your name or email.
                    </motion.p>
                  )}
                </AnimatePresence>
              </form>
            </div>

            {/* My Grievances */}
            <div className="glass-card rounded-xl p-6">
              <h2 className="text-base font-semibold text-foreground mb-4">My Submitted Grievances</h2>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                </div>
              ) : myGrievances.length === 0 ? (
                <p className="text-foreground-muted text-center py-8 text-sm">
                  No grievances submitted yet. Anonymous submissions won't appear here.
                </p>
              ) : (
                <div className="space-y-3">
                  {myGrievances.map((grievance) => (
                    <div key={grievance.id} className="bg-secondary/60 border border-border/60 rounded-lg p-4" data-testid={`my-grievance-${grievance.id}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-primary">{grievance.category}</span>
                        {getStatusBadge(grievance.status)}
                      </div>
                      <p className="text-foreground text-sm mb-3 leading-relaxed">{grievance.description}</p>
                      <div className="flex items-center justify-between text-[11px] text-foreground-muted">
                        <span>Submitted: {new Date(grievance.created_at).toLocaleDateString()}</span>
                        {grievance.hr_notes && <span className="text-primary">HR responded</span>}
                      </div>
                      {grievance.hr_notes && (
                        <div className="mt-3 pt-3 border-t border-border/60">
                          <p className="text-[11px] font-medium text-foreground-muted mb-1">HR Response:</p>
                          <p className="text-sm text-foreground">{grievance.hr_notes}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default GrievanceSubmit;
