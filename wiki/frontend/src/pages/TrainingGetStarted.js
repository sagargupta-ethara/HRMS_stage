import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { ChevronRight, ChevronLeft, StickyNote, Bookmark, BookmarkCheck, Plus, X, Download, Save, Edit, Maximize2, Minimize2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSecurePdfDocument } from '../lib/pdfDocument';

const TrainingGetStarted = () => {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [scale, setScale] = useState(1.3);
  
  // Bookmark state
  const [bookmark, setBookmark] = useState(null);
  const [savingBookmark, setSavingBookmark] = useState(false);
  
  // Notes state
  const [notes, setNotes] = useState([]);
  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const pageSlug = 'training-get-started';
  const [bookmarkRestored, setBookmarkRestored] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // Load PDF first, then fetch bookmark
  useEffect(() => {
    const loadPdf = async () => {
      try {
        setLoading(true);
        const loadingTask = getSecurePdfDocument('psychology-of-prompting', token);
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setLoading(false);
      } catch (error) {
        /* noop */
        toast.error('Failed to load document');
        setLoading(false);
      }
    };
    
    if (token) {
      loadPdf();
    }
  }, [token]);

  // Fetch bookmark and notes AFTER PDF is loaded
  useEffect(() => {
    if (pdfDoc && token && !loading) {
      fetchBookmark();
      fetchNotes();
    }
  }, [pdfDoc, token, loading]);

  // Restore bookmarked page - only once
  useEffect(() => {
    if (bookmark && pdfDoc && !loading && !bookmarkRestored && totalPages > 0) {
      const savedPage = Math.round(bookmark.scroll_position);
      if (savedPage >= 1 && savedPage <= totalPages) {
        setCurrentPage(savedPage);
        setBookmarkRestored(true);
        toast.success(`Restored to page ${savedPage}`);
      }
    }
  }, [bookmark, pdfDoc, totalPages, loading, bookmarkRestored]);

  // Render current page
  useEffect(() => {
    const renderPage = async () => {
      if (!pdfDoc || !canvasRef.current || rendering) return;
      
      setRendering(true);
      try {
        const page = await pdfDoc.getPage(currentPage);
        const renderScale = maximized ? 2.0 : scale;
        const viewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
      } catch (error) {
      console.error('fetch failed:', error);
    }
      setRendering(false);
    };
    
    renderPage();
  }, [pdfDoc, currentPage, scale, maximized]);

  const fetchBookmark = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bookmarks/${pageSlug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setBookmark(data.bookmark);
    } catch (error) {
      console.error('fetch failed:', error);
    }
  };

  const fetchNotes = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notes/${pageSlug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setNotes(data.notes || []);
    } catch (error) {
      console.error('fetch failed:', error);
    }
  };

  const handleSaveBookmark = async () => {
    setSavingBookmark(true);
    try {
      const pageToSave = Math.round(currentPage); // Ensure integer
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bookmarks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          page_slug: pageSlug,
          scroll_position: pageToSave
        })
      });
      
      if (response.ok) {
        setBookmark({ scroll_position: pageToSave, page_slug: pageSlug });
        setBookmarkRestored(true); // Prevent re-restoration
        toast.success(`Bookmarked page ${pageToSave}!`);
      }
    } catch (error) {
      toast.error('Failed to save bookmark');
    } finally {
      setSavingBookmark(false);
    }
  };

  const handleGoToBookmark = () => {
    if (bookmark) {
      const savedPage = Math.round(bookmark.scroll_position);
      setCurrentPage(savedPage);
      toast.success(`Jumped to bookmarked page ${savedPage}`);
    }
  };

  const handleDeleteBookmark = async () => {
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bookmarks/${pageSlug}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setBookmark(null);
      setBookmarkRestored(false); // Allow new bookmark to restore
      toast.success('Bookmark removed');
    } catch (error) {
      toast.error('Failed to remove bookmark');
    }
  };

  const handleAddNote = async () => {
    if (!newNoteContent.trim()) return;
    
    setSavingNote(true);
    try {
      const noteWithPage = `[Page ${currentPage}] ${newNoteContent.trim()}`;
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          page_slug: pageSlug,
          content: noteWithPage
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setNotes([data.note, ...notes]);
        setNewNoteContent('');
        toast.success('Note added!');
      }
    } catch (error) {
      toast.error('Failed to add note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleUpdateNote = async (noteId) => {
    if (!editingNoteContent.trim()) return;
    
    setSavingNote(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notes/${noteId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content: editingNoteContent.trim() })
      });
      
      if (response.ok) {
        const data = await response.json();
        setNotes(notes.map(n => n.id === noteId ? data.note : n));
        setEditingNoteId(null);
        setEditingNoteContent('');
        toast.success('Note updated!');
      }
    } catch (error) {
      toast.error('Failed to update note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notes/${noteId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setNotes(notes.filter(n => n.id !== noteId));
      toast.success('Note deleted');
    } catch (error) {
      toast.error('Failed to delete note');
    }
  };

  const handleExportNotes = async () => {
    const exportContent = `
# Psychology of Prompting - My Notes
## Exported by: ${user?.name}
## Date: ${new Date().toLocaleString()}

---

${notes.map(note => `
### Note
${note.content}
*Added: ${new Date(note.created_at).toLocaleString()}*

---
`).join('\n')}
    `;
    
    const blob = new Blob([exportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'psychology-of-prompting-notes.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Notes exported!');
  };

  const goToPrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      goToPrevPage();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      goToNextPage();
    } else if (e.key === 'Escape' && maximized) {
      setMaximized(false);
    }
  }, [currentPage, totalPages, maximized]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Prevent right-click and download shortcuts
  const handleContextMenu = (e) => e.preventDefault();
  
  useEffect(() => {
    const preventDownload = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'p')) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', preventDownload);
    return () => document.removeEventListener('keydown', preventDownload);
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {/* Breadcrumb */}
            <div className="flex items-center text-sm text-foreground-muted mb-4">
              <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/dashboard')}>Home</span>
              <ChevronRight size={16} className="mx-2" />
              <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/wiki/training')}>Training & Learning</span>
              <ChevronRight size={16} className="mx-2" />
              <span className="text-foreground">Training: Get Started</span>
            </div>

            {/* Header with Bookmark and Notes buttons */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-2xl font-heading font-bold text-foreground mb-1" data-testid="training-page-title">
                  The Psychology of Prompting
                </h1>
                <p className="text-sm text-foreground-muted">
                  Master the art of AI communication
                </p>
              </div>
              <div className="flex gap-2">
                {/* Bookmark Button */}
                <button
                  onClick={bookmark ? handleGoToBookmark : handleSaveBookmark}
                  disabled={savingBookmark || loading}
                  data-testid="bookmark-button"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    bookmark 
                      ? 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30' 
                      : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
                  }`}
                  title={bookmark ? `Go to bookmarked page ${bookmark.scroll_position}` : 'Bookmark this page'}
                >
                  {bookmark ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                  <span>{savingBookmark ? 'Saving...' : (bookmark ? `Page ${bookmark.scroll_position}` : 'Bookmark')}</span>
                </button>

                {bookmark && (
                  <button
                    onClick={handleDeleteBookmark}
                    className="px-2 py-2 text-foreground-muted hover:text-red-400 transition-colors"
                    title="Remove bookmark"
                  >
                    <X size={18} />
                  </button>
                )}
                
                {/* Notes Panel Toggle */}
                <button
                  onClick={() => setShowNotesPanel(!showNotesPanel)}
                  data-testid="notes-toggle-button"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                    showNotesPanel 
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
                      : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
                  }`}
                >
                  <StickyNote size={18} />
                  <span>Notes</span>
                  {notes.length > 0 && (
                    <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">{notes.length}</span>
                  )}
                </button>
              </div>
            </div>

            {/* Notes Panel */}
            <AnimatePresence>
              {showNotesPanel && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-4 overflow-hidden"
                >
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4" data-testid="notes-panel">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                        <StickyNote size={18} className="text-amber-400" />
                        Your Notes
                      </h3>
                      {notes.length > 0 && (
                        <button
                          onClick={handleExportNotes}
                          data-testid="export-notes-button"
                          className="flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors text-sm"
                        >
                          <Download size={14} />
                          <span>Export</span>
                        </button>
                      )}
                    </div>
                    
                    {/* Add New Note */}
                    <div className="mb-3">
                      <div className="flex gap-2">
                        <input
                          value={newNoteContent}
                          onChange={(e) => setNewNoteContent(e.target.value)}
                          placeholder={`Add note for page ${currentPage}...`}
                          className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                          data-testid="new-note-input"
                          onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                        />
                        <button
                          onClick={handleAddNote}
                          disabled={!newNoteContent.trim() || savingNote}
                          data-testid="add-note-button"
                          className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                          <Plus size={16} />
                          Add
                        </button>
                      </div>
                    </div>
                    
                    {/* Notes List */}
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {notes.length === 0 ? (
                        <p className="text-foreground-muted text-center py-2 text-sm">No notes yet</p>
                      ) : (
                        notes.map((note) => (
                          <div key={note.id} className="bg-background border border-border rounded-lg p-3 text-sm">
                            {editingNoteId === note.id ? (
                              <div className="flex gap-2">
                                <input
                                  value={editingNoteContent}
                                  onChange={(e) => setEditingNoteContent(e.target.value)}
                                  className="flex-1 px-2 py-1 bg-secondary border border-border rounded text-foreground text-sm"
                                />
                                <button onClick={() => handleUpdateNote(note.id)} className="text-primary"><Save size={14} /></button>
                                <button onClick={() => setEditingNoteId(null)} className="text-foreground-muted"><X size={14} /></button>
                              </div>
                            ) : (
                              <div className="flex justify-between items-start">
                                <p className="text-foreground flex-1">{note.content}</p>
                                <div className="flex gap-1 ml-2">
                                  <button onClick={() => { setEditingNoteId(note.id); setEditingNoteContent(note.content); }} className="text-foreground-muted hover:text-primary"><Edit size={12} /></button>
                                  <button onClick={() => handleDeleteNote(note.id)} className="text-foreground-muted hover:text-red-400"><X size={12} /></button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* PDF Viewer */}
            <div 
              className={maximized ? 'fixed inset-0 z-[100] flex flex-col' : 'bg-background-card border border-border rounded-xl overflow-hidden'}
              onContextMenu={handleContextMenu}
              style={{ userSelect: 'none' }}
              data-testid="pdf-viewer-container"
            >
              {/* Viewer Header */}
              <div className={`px-4 py-3 border-b flex items-center justify-between shrink-0 ${maximized ? 'bg-background-card border-border' : 'bg-gradient-to-r from-primary/10 to-transparent border-border'}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">Psychology of Prompting</span>
                  <span className="text-xs text-foreground-muted">Read-Only</span>
                </div>
                <div className="flex items-center gap-3">
                  {maximized && (
                    <div className="flex items-center gap-2 bg-secondary px-3 py-1.5 rounded-lg">
                      <button onClick={goToPrevPage} disabled={currentPage <= 1} className="text-foreground-muted hover:text-foreground disabled:opacity-30"><ChevronLeft size={18} /></button>
                      <span className="text-sm text-foreground">Page</span>
                      <input type="number" min={1} max={totalPages} value={currentPage} onChange={(e) => { const p = parseInt(e.target.value); if (p >= 1 && p <= totalPages) setCurrentPage(p); }} className="w-14 px-2 py-0.5 bg-background border border-border rounded text-center text-foreground text-sm" />
                      <span className="text-sm text-foreground-muted">of {totalPages}</span>
                      <button onClick={goToNextPage} disabled={currentPage >= totalPages} className="text-foreground-muted hover:text-foreground disabled:opacity-30"><ChevronRight size={18} /></button>
                    </div>
                  )}
                  {!maximized && <span className="text-sm text-foreground-muted hidden sm:block">Arrow keys to navigate</span>}
                  <button
                    onClick={() => setMaximized(!maximized)}
                    data-testid={maximized ? 'minimize-reader-button' : 'maximize-reader-button'}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-foreground rounded-lg text-xs font-medium transition-colors border border-border"
                  >
                    {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    <span className="hidden sm:inline">{maximized ? 'Exit' : 'Maximize'}</span>
                  </button>
                </div>
              </div>

              <div className={`flex flex-col items-center p-4 ${maximized ? 'flex-1 overflow-auto bg-background' : 'bg-background'}`}>
                {loading ? (
                  <div className="flex items-center justify-center h-96">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
                      <p className="text-foreground-muted">Loading document...</p>
                    </div>
                  </div>
                ) : (
                  <>
                    {!maximized && (
                      <div className="flex items-center gap-4 mb-4">
                        <button onClick={goToPrevPage} disabled={currentPage <= 1} className="flex items-center gap-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 hover:bg-primary-hover transition-colors" data-testid="prev-page-btn"><ChevronLeft size={20} />Previous</button>
                        <div className="flex items-center gap-2 bg-secondary px-4 py-2 rounded-lg">
                          <span className="text-foreground font-medium">Page</span>
                          <input type="number" min={1} max={totalPages} value={currentPage} onChange={(e) => { const pg = parseInt(e.target.value); if (pg >= 1 && pg <= totalPages) setCurrentPage(pg); }} className="w-16 px-2 py-1 bg-background border border-border rounded text-center text-foreground" />
                          <span className="text-foreground-muted">of {totalPages}</span>
                        </div>
                        <button onClick={goToNextPage} disabled={currentPage >= totalPages} className="flex items-center gap-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg disabled:opacity-40 hover:bg-primary-hover transition-colors" data-testid="next-page-btn">Next<ChevronRight size={20} /></button>
                      </div>
                    )}
                    <div className="relative">
                      <canvas ref={canvasRef} className="shadow-2xl rounded-lg" style={maximized ? { maxHeight: 'calc(100vh - 80px)', width: 'auto' } : { maxWidth: '100%', height: 'auto' }} />
                      {rendering && (
                        <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg">
                          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                        </div>
                      )}
                    </div>
                    {!maximized && (
                      <div className="flex items-center gap-4 mt-4">
                        <button onClick={goToPrevPage} disabled={currentPage <= 1} className="flex items-center gap-1 px-4 py-2 bg-secondary text-foreground rounded-lg disabled:opacity-40 hover:bg-secondary/80 transition-colors"><ChevronLeft size={20} />Previous</button>
                        <span className="text-foreground-muted">Page {currentPage} of {totalPages}</span>
                        <button onClick={goToNextPage} disabled={currentPage >= totalPages} className="flex items-center gap-1 px-4 py-2 bg-secondary text-foreground rounded-lg disabled:opacity-40 hover:bg-secondary/80 transition-colors">Next<ChevronRight size={20} /></button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {!maximized && (
                <div className="bg-background px-4 py-2 text-center border-t border-border">
                  <span className="text-xs text-foreground-muted">Internal training document - Downloading prohibited</span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default TrainingGetStarted;
