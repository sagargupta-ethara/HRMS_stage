import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import RichTextEditor from '../components/RichTextEditor';
import { useAuth } from '../context/AuthContext';
import { Save, X } from 'lucide-react';
import { toast } from 'sonner';

const WikiPageEdit = () => {
  const { slug } = useParams();
  const location = useLocation();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    category: new URLSearchParams(location.search).get('category') || '',
    subcategory: '',
    content_html: '',
    content_text: ''
  });

  const categories = [
    { id: 'foundation', name: 'Foundation', subcategories: ['Core Values', 'What We Do', 'Organigram'] },
    { id: 'strategy', name: 'Strategy & Leadership', subcategories: ['Company Vision', 'Leadership Resources'] },
    { id: 'operations', name: 'Operations', subcategories: ['Process Flow', 'User Control', 'Operational Guidelines'] },
    { id: 'hr', name: 'HR', subcategories: ['Leave Policy', 'Code of Conduct', 'Leave Application Process'] },
    { id: 'finance', name: 'Finance', subcategories: ['Budget Approval', 'Expense Reimbursement'] },
    { id: 'compliance', name: 'Compliance & Legal', subcategories: ['Policies', 'Governance Documents'] },
    { id: 'knowledge', name: 'Knowledge Systems', subcategories: ['AI Knowledge Vault', 'Research Updates', 'RL Methods'] },
    { id: 'learning', name: 'Learning & Development', subcategories: ['Leadership Reading Hub', 'Learning Resources'] }
  ];

  const isEditMode = slug !== 'new';

  useEffect(() => {
    if (isEditMode) {
      fetchPage();
    }
  }, [slug]);

  const fetchPage = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/wiki/pages/${slug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setFormData({
        title: data.page.title,
        category: data.page.category,
        subcategory: data.page.subcategory || '',
        content_html: data.page.content_html,
        content_text: data.page.content_text
      });
    } catch (error) {
      toast.error('Failed to fetch page');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.title || !formData.category) {
      toast.error('Please fill in all required fields');
      return;
    }

    setSaving(true);
    try {
      const url = isEditMode
        ? `${process.env.REACT_APP_BACKEND_URL}/api/wiki/pages/${slug}`
        : `${process.env.REACT_APP_BACKEND_URL}/api/wiki/pages`;
      
      const method = isEditMode ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        toast.success(isEditMode ? 'Page updated successfully' : 'Page created successfully');
        navigate(`/wiki/page/${data.page.slug}`);
      } else {
        toast.error(data.detail || 'Failed to save page');
      }
    } catch (error) {
      toast.error('Failed to save page');
    } finally {
      setSaving(false);
    }
  };

  const handleEditorChange = ({ html, text }) => {
    setFormData(prev => ({
      ...prev,
      content_html: html,
      content_text: text
    }));
  };

  const canEdit = user?.role === 'admin' || user?.role === 'editor';

  if (!canEdit) {
    navigate('/dashboard');
    return null;
  }

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

  const selectedCategory = categories.find(c => c.id === formData.category);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-3xl font-heading font-bold text-foreground" data-testid="edit-page-title">
                {isEditMode ? 'Edit Page' : 'Create New Page'}
              </h1>
              <div className="flex space-x-3">
                <button
                  onClick={() => navigate(-1)}
                  data-testid="cancel-button"
                  className="flex items-center space-x-2 px-4 py-2 bg-secondary text-foreground rounded-lg hover:bg-secondary/80 border border-border transition-colors"
                >
                  <X size={18} />
                  <span>Cancel</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  data-testid="save-button"
                  className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors shadow-glow disabled:opacity-50"
                >
                  <Save size={18} />
                  <span>{saving ? 'Saving...' : 'Save'}</span>
                </button>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  data-testid="title-input"
                  className="w-full px-4 py-3 bg-background-card border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 text-foreground"
                  placeholder="Page title"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Category *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value, subcategory: '' })}
                    data-testid="category-select"
                    className="w-full px-4 py-3 bg-background-card border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 text-foreground"
                  >
                    <option value="">Select category</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Subcategory</label>
                  <select
                    value={formData.subcategory}
                    onChange={(e) => setFormData({ ...formData, subcategory: e.target.value })}
                    disabled={!formData.category}
                    data-testid="subcategory-select"
                    className="w-full px-4 py-3 bg-background-card border border-border rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 text-foreground disabled:opacity-50"
                  >
                    <option value="">Select subcategory</option>
                    {selectedCategory?.subcategories.map(sub => (
                      <option key={sub} value={sub}>{sub}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Content *</label>
                <RichTextEditor
                  content={formData.content_html}
                  onChange={handleEditorChange}
                  placeholder="Start writing your content..."
                />
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default WikiPageEdit;