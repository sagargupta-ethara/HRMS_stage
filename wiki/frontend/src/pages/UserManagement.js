import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { Users, Shield, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const UserManagement = () => {
  const { token, user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      toast.error('Failed to fetch users');
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (email, newRole) => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/users/${email}/role`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ role: newRole })
      });

      if (response.ok) {
        toast.success('Role updated successfully');
        fetchUsers();
      } else {
        toast.error('Failed to update role');
      }
    } catch (error) {
      toast.error('Failed to update role');
    }
  };

  const handleDeleteUser = async (email) => {
    if (!window.confirm(`Are you sure you want to delete ${email}?`)) return;

    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/users/${email}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('User deleted successfully');
        fetchUsers();
      } else {
        const data = await response.json();
        toast.error(data.detail || 'Failed to delete user');
      }
    } catch (error) {
      toast.error('Failed to delete user');
    }
  };

  if (loading) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center min-h-screen">
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
            className="mb-8"
          >
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-heading font-bold text-foreground mb-2" data-testid="user-management-title">User Management</h1>
                <p className="text-foreground-muted">{users.length} total users</p>
              </div>
              <button
                onClick={fetchUsers}
                data-testid="refresh-users-button"
                className="flex items-center space-x-2 px-4 py-2 bg-secondary text-foreground rounded-lg hover:bg-secondary/80 border border-border transition-colors"
              >
                <RefreshCw size={18} />
                <span>Refresh</span>
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-background-card border border-border rounded-xl overflow-hidden"
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-secondary border-b border-border">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">User</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">Email</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">Role</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">Joined</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u, idx) => (
                    <motion.tr
                      key={u.email}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + idx * 0.05 }}
                      className="hover:bg-secondary/30 transition-colors"
                      data-testid={`user-row-${u.email}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <Users className="text-primary" size={20} />
                          </div>
                          <span className="font-medium text-foreground">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-foreground-muted">{u.email}</td>
                      <td className="px-6 py-4">
                        <select
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.email, e.target.value)}
                          disabled={u.email === user.email}
                          data-testid={`role-select-${u.email}`}
                          className={`px-3 py-1 rounded border text-sm font-medium ${
                            u.role === 'admin' ? 'bg-primary/15 text-primary border-primary/30' :
                            u.role === 'hr' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                            u.role === 'editor' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' :
                            'bg-[rgba(144,141,206,0.15)] text-accent border-accent/20'
                          } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                          <option value="admin">Admin</option>
                          <option value="hr">HR</option>
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 text-foreground-muted text-sm">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {u.email !== user.email && (
                          <button
                            onClick={() => handleDeleteUser(u.email)}
                            data-testid={`delete-user-${u.email}`}
                            className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mt-8 bg-background-card border border-border rounded-xl p-6"
          >
            <div className="flex items-start space-x-4">
              <Shield className="text-primary flex-shrink-0 mt-1" size={24} />
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Role Permissions</h3>
                <ul className="space-y-2 text-sm text-foreground-muted">
                  <li><strong className="text-primary">Admin:</strong> Full access - can manage users, create/edit/delete pages, manage grievances</li>
                  <li><strong className="text-amber-400">HR:</strong> Can access and manage the Grievance Portal</li>
                  <li><strong className="text-cyan-400">Editor:</strong> Can view wiki content (legacy role)</li>
                  <li><strong className="text-accent">Viewer:</strong> Can view wiki, submit grievances, chat with Jarvis, and take notes</li>
                </ul>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default UserManagement;