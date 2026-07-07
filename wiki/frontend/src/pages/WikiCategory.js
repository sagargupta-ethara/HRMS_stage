import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { FileText, Clock, ArrowRight, ChevronRight, BookOpen, Shield, Calendar, Users, Briefcase, Award, CircleHelp } from 'lucide-react';
import { toast } from 'sonner';

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } };

const CATEGORY_LANDING = {
  foundation: {
    title: 'Foundation',
    description: 'The building blocks of Ethara AI — our identity, purpose, and the people who drive it all forward.',
    sections: [
      {
        name: 'Core Values',
        slug: '/wiki/page/core-values',
        icon: Award,
        description: 'The principles that define who we are, how we work, and what we stand for as a company.',
        accent: 'from-primary/15 to-accent/10 border-primary/20'
      },
      {
        name: 'What We Do',
        slug: '/wiki/page/what-we-do',
        icon: Briefcase,
        description: 'A clear overview of our services, capabilities, and the value we deliver to clients worldwide.',
        accent: 'from-blue-500/20 to-indigo-500/10 border-blue-500/20'
      },
      {
        name: 'Organigram',
        slug: '/wiki/page/organization-chart',
        icon: Users,
        description: 'Meet our leadership team and understand how Ethara AI is structured across all divisions.',
        accent: 'from-accent/20 to-primary/10 border-accent/20'
      }
    ]
  },
  hr: {
    title: 'HR',
    description: 'Everything you need to know about policies, holidays, and workplace conduct at Ethara AI.',
    sections: [
      {
        name: 'Leave Policy',
        slug: '/wiki/page/leave-policy',
        icon: BookOpen,
        description: 'Comprehensive guide to leave types, entitlements, application process, and approval workflows.',
        accent: 'from-primary/15 to-accent/10 border-primary/20'
      },
      {
        name: 'Holiday Calendar',
        slug: '/hr/holiday-calendar',
        icon: Calendar,
        description: 'Complete list of company holidays and observances for the current year.',
        accent: 'from-amber-500/20 to-yellow-500/10 border-amber-500/20'
      },
      {
        name: 'Code of Conduct',
        slug: '/wiki/page/code-of-conduct',
        icon: Shield,
        description: 'Our standards for professional behavior, ethics, and workplace expectations for every team member.',
        accent: 'from-rose-500/20 to-pink-500/10 border-rose-500/20'
      },
      {
        name: 'FAQs',
        slug: '/wiki/page/faqs',
        icon: CircleHelp,
        description: 'Answers to the most commonly asked questions from new employees joining Ethara AI.',
        accent: 'from-primary/20 to-accent/10 border-primary/20'
      }
    ]
  }
};

const CategoryLanding = ({ config, categoryId }) => {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-background" data-testid={`${categoryId}-landing`}>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 lg:p-10">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-foreground-muted mb-5" data-testid="breadcrumb">
            <Link to="/dashboard" className="hover:text-primary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-foreground">{config.title}</span>
          </div>

          {/* Hero Header */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <div className="relative rounded-2xl bg-gradient-to-br from-background-card via-background-card to-primary/10 border border-border p-8 lg:p-10 overflow-hidden">
              <div className="absolute top-0 right-0 w-72 h-72 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
              <div className="relative z-10">
                <h1 className="text-2xl lg:text-3xl font-heading font-bold text-foreground mb-2" data-testid="category-title">{config.title}</h1>
                <p className="text-sm text-foreground-muted leading-relaxed max-w-2xl">{config.description}</p>
              </div>
            </div>
          </motion.div>

          {/* Sub-section Cards */}
          <motion.div variants={container} initial="hidden" animate="show" className="space-y-4">
            {config.sections.map((section) => {
              const Icon = section.icon;
              return (
                <motion.div
                  key={section.name}
                  variants={item}
                  whileHover={{ x: 4 }}
                  onClick={() => navigate(section.slug)}
                  data-testid={`section-card-${section.name.toLowerCase().replace(/\s+/g, '-')}`}
                  className="glass-card group cursor-pointer rounded-xl p-6"
                >
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
                      <Icon size={22} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <h3 className="text-base font-heading font-semibold text-foreground group-hover:text-primary transition-colors">{section.name}</h3>
                        <ArrowRight size={16} className="text-foreground-muted group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" />
                      </div>
                      <p className="text-sm text-foreground-muted leading-relaxed">{section.description}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </main>
    </div>
  );
};

const CATEGORIES = [
  { id: 'foundation', name: 'Foundation', subcategories: ['Core Values', 'What We Do', 'Organigram'] },
  { id: 'operations', name: 'Operations', subcategories: ['Process Flow'] },
  { id: 'hr', name: 'HR', subcategories: ['Leave Policy', 'Holiday Calendar', 'Code of Conduct', 'FAQs'] },
  { id: 'training', name: 'Training & Learning', subcategories: ['Deep Learning', 'Training: Get Started'] }
];

const WikiCategory = () => {
  const { categoryId } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [pages, setPages] = useState([]);
  const [category, setCategory] = useState(null);
  const [loading, setLoading] = useState(true);

  const isLanding = !!CATEGORY_LANDING[categoryId];

  useEffect(() => {
    if (isLanding) { setLoading(false); return; }
    const cat = CATEGORIES.find(c => c.id === categoryId);
    setCategory(cat);
    const fetchPages = async () => {
      try {
        const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/wiki/pages?category=${categoryId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        setPages(data.pages || []);
      } catch (error) { toast.error('Failed to fetch pages'); }
      finally { setLoading(false); }
    };
    fetchPages();
  }, [categoryId, isLanding, token]);

  if (isLanding) {
    return <CategoryLanding config={CATEGORY_LANDING[categoryId]} categoryId={categoryId} />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8 flex items-center justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 lg:p-10">
          <div className="flex items-center gap-2 text-sm text-foreground-muted mb-5" data-testid="breadcrumb">
            <Link to="/dashboard" className="hover:text-primary transition-colors">Home</Link>
            <ChevronRight size={14} />
            <span className="text-foreground">{category?.name}</span>
          </div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <div className="relative rounded-2xl bg-gradient-to-br from-background-card via-background-card to-primary/10 border border-border p-8 lg:p-10 overflow-hidden">
              <div className="absolute top-0 right-0 w-72 h-72 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
              <div className="relative z-10">
                <h1 className="text-2xl lg:text-3xl font-heading font-bold text-foreground mb-1" data-testid="category-title">{category?.name}</h1>
                <p className="text-sm text-foreground-muted">{pages.length} page{pages.length !== 1 ? 's' : ''} in this category</p>
              </div>
            </div>
          </motion.div>

          {pages.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card rounded-xl p-12 text-center" data-testid="no-pages-message">
              <FileText className="mx-auto mb-4 text-foreground-muted" size={56} />
              <p className="text-foreground-muted mb-1">No pages in this category yet</p>
            </motion.div>
          ) : (
            <motion.div variants={container} initial="hidden" animate="show" className="grid gap-4">
              {pages.map((page) => (
                <motion.div
                  key={page.slug}
                  variants={item}
                  whileHover={{ x: 4 }}
                  onClick={() => navigate(`/wiki/page/${page.slug}`)}
                  data-testid={`wiki-page-card-${page.slug}`}
                  className="glass-card rounded-xl p-5 cursor-pointer group"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <FileText size={20} className="text-primary mt-0.5 shrink-0" />
                      <div>
                        <h3 className="font-heading font-semibold text-foreground group-hover:text-primary transition-colors">{page.title}</h3>
                        {page.subcategory && <p className="text-xs text-foreground-muted mt-1">{page.subcategory}</p>}
                        <div className="flex items-center gap-4 mt-2 text-xs text-foreground-muted">
                          <div className="flex items-center gap-1.5"><Clock size={12} /><span>{new Date(page.updated_at).toLocaleDateString()}</span></div>
                        </div>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-foreground-muted group-hover:text-primary group-hover:translate-x-1 transition-all mt-1 shrink-0" />
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
};

export default WikiCategory;
