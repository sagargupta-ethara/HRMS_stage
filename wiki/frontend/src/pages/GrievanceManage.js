import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { ClipboardList, Clock, AlertCircle, CheckCircle, User, UserX, Filter, MessageSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

const GrievanceManage = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [grievances, setGrievances] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, in_review: 0, addressed: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selectedGrievance, setSelectedGrievance] = useState(null);
  const [hrNotes, setHrNotes] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (user?.role !== 'admin' && user?.role !== 'hr') {
      navigate('/dashboard');
      toast.error('Access denied. HR access required.');
      return;
    }
    fetchGrievances();
  }, [user]);

  const fetchGrievances = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/grievances`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.status === 403) {
        navigate('/dashboard');
        toast.error('Access denied');
        return;
      }
      
      const data = await response.json();
      setGrievances(data.grievances || []);
      setStats(data.stats || { total: 0, pending: 0, in_review: 0, addressed: 0 });
    } catch (error) {
      toast.error('Failed to fetch grievances');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (grievanceId, newStatus) => {
    setUpdating(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/grievances/${grievanceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: newStatus,
          hr_notes: hrNotes || null
        })
      });

      if (response.ok) {
        toast.success(`Grievance marked as ${newStatus.replace('_', ' ')}`);
        fetchGrievances();
        setSelectedGrievance(null);
        setHrNotes('');
      } else {
        toast.error('Failed to update grievance');
      }
    } catch (error) {
      toast.error('Failed to update grievance');
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (grievanceId) => {
    if (!window.confirm('Are you sure you want to delete this grievance?')) return;
    
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/grievances/${grievanceId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Grievance deleted');
        fetchGrievances();
      } else {
        toast.error('Failed to delete grievance');
      }
    } catch (error) {
      toast.error('Failed to delete grievance');
    }
  };

  const filteredGrievances = filter === 'all' 
    ? grievances 
    : grievances.filter(g => g.status === filter);

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: { icon: Clock, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Pending' },
      in_review: { icon: AlertCircle, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'In Review' },
      addressed: { icon: CheckCircle, color: 'text-green-400 bg-green-500/10 border-green-500/20', label: 'Addressed' }
    };
    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;
    
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border ${config.color}`}>
        <Icon size={12} />
        {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-3 mb-8">
              <div className="p-3 bg-primary/10 rounded-xl">
                <ClipboardList size={28} className="text-primary" />
              </div>
              <div>
                <h1 className="text-3xl font-heading font-bold text-foreground">Grievance Management</h1>
                <p className="text-foreground-muted">Review and address employee concerns</p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div className="bg-background-card border border-border rounded-xl p-4">
                <p className="text-foreground-muted text-sm">Total</p>
                <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              </div>
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                <p className="text-amber-400 text-sm">Pending</p>
                <p className="text-2xl font-bold text-amber-400">{stats.pending}</p>
              </div>
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4">
                <p className="text-blue-400 text-sm">In Review</p>
                <p className="text-2xl font-bold text-blue-400">{stats.in_review}</p>
              </div>
              <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                <p className="text-green-400 text-sm">Addressed</p>
                <p className="text-2xl font-bold text-green-400">{stats.addressed}</p>
              </div>
            </div>

            {/* Filter */}
            <div className="flex items-center gap-2 mb-6">
              <Filter size={18} className="text-foreground-muted" />
              <div className="flex gap-2">
                {['all', 'pending', 'in_review', 'addressed'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      filter === f
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-foreground-muted hover:text-foreground'
                    }`}
                    data-testid={`filter-${f}`}
                  >
                    {f === 'all' ? 'All' : f.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>

            {/* Grievances List */}
            <div className="space-y-4">
              {filteredGrievances.length === 0 ? (
                <div className="bg-background-card border border-border rounded-xl p-8 text-center">
                  <p className="text-foreground-muted">No grievances found</p>
                </div>
              ) : (
                filteredGrievances.map((grievance) => (
                  <div
                    key={grievance.id}
                    className="bg-background-card border border-border rounded-xl p-6"
                    data-testid={`grievance-${grievance.id}`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        {grievance.is_anonymous ? (
                          <div className="p-2 bg-[rgba(144,141,206,0.15)] rounded-lg">
                            <UserX size={20} className="text-accent" />
                          </div>
                        ) : (
                          <div className="p-2 bg-secondary rounded-lg">
                            <User size={20} className="text-foreground-muted" />
                          </div>
                        )}
                        <div>
                          <p className="font-medium text-foreground">
                            {grievance.is_anonymous ? 'Anonymous' : grievance.submitted_by_name}
                          </p>
                          <p className="text-xs text-foreground-muted">
                            {grievance.is_anonymous ? 'Identity protected' : grievance.submitted_by}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(grievance.status)}
                        {user?.role === 'admin' && (
                          <button
                            onClick={() => handleDelete(grievance.id)}
                            className="p-1.5 text-foreground-muted hover:text-red-400 transition-colors"
                            data-testid={`delete-grievance-${grievance.id}`}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mb-4">
                      <span className="inline-block px-2 py-1 text-xs bg-primary/10 text-primary rounded mb-2">
                        {grievance.category}
                      </span>
                      <p className="text-foreground">{grievance.description}</p>
                    </div>

                    <div className="flex items-center justify-between text-xs text-foreground-muted mb-4">
                      <span>Submitted: {new Date(grievance.created_at).toLocaleString()}</span>
                      {grievance.addressed_at && (
                        <span>Addressed: {new Date(grievance.addressed_at).toLocaleString()}</span>
                      )}
                    </div>

                    {grievance.hr_notes && (
                      <div className="bg-secondary/50 rounded-lg p-3 mb-4">
                        <p className="text-xs font-medium text-foreground-muted mb-1">HR Notes:</p>
                        <p className="text-sm text-foreground">{grievance.hr_notes}</p>
                      </div>
                    )}

                    {grievance.status !== 'addressed' && (
                      <div className="pt-4 border-t border-border">
                        {selectedGrievance === grievance.id ? (
                          <div className="space-y-3">
                            <textarea
                              value={hrNotes}
                              onChange={(e) => setHrNotes(e.target.value)}
                              placeholder="Add notes for the employee (optional)..."
                              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                              rows={2}
                              data-testid={`hr-notes-input-${grievance.id}`}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => { setSelectedGrievance(null); setHrNotes(''); }}
                                className="px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground"
                              >
                                Cancel
                              </button>
                              {grievance.status === 'pending' && (
                                <button
                                  onClick={() => handleUpdateStatus(grievance.id, 'in_review')}
                                  disabled={updating}
                                  className="px-3 py-1.5 text-sm bg-blue-500/10 text-blue-400 rounded-lg hover:bg-blue-500/20 disabled:opacity-50"
                                  data-testid={`mark-in-review-${grievance.id}`}
                                >
                                  Mark In Review
                                </button>
                              )}
                              <button
                                onClick={() => handleUpdateStatus(grievance.id, 'addressed')}
                                disabled={updating}
                                className="px-3 py-1.5 text-sm bg-green-500/10 text-green-400 rounded-lg hover:bg-green-500/20 disabled:opacity-50"
                                data-testid={`mark-addressed-${grievance.id}`}
                              >
                                Mark as Addressed
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setSelectedGrievance(grievance.id)}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-secondary text-foreground-muted rounded-lg hover:text-foreground transition-colors"
                            data-testid={`respond-button-${grievance.id}`}
                          >
                            <MessageSquare size={16} />
                            Respond
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default GrievanceManage;
