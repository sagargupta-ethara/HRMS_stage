import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { ChevronRight, ChevronLeft, ChevronDown, StickyNote, Bookmark, BookmarkCheck, Plus, X, Download, Save, Edit, FileText, Folder, FolderOpen, Maximize2, Minimize2 } from 'lucide-react';
import { toast } from 'sonner';
import { getSecurePdfDocument } from '../lib/pdfDocument';

// Deep Learning Document Library Structure
const DEEP_LEARNING_LIBRARY = {
  title: "LLM Model Training Document Library",
  folders: [
    {
      id: "benchmarks-evaluation",
      name: "Benchmarks & Evaluation",
      documents: [
        { id: "software-engineering-testing-llm", title: "A Software Engineering Perspective on Testing Large Language Models" },
        { id: "hallulens-benchmark", title: "HalluLens: LLM Hallucination Benchmark" },
        { id: "humanitys-last-exam", title: "Humanity's Last Exam" }
      ]
    },
    {
      id: "coding-agents",
      name: "Coding Agents & Software Benchmarks",
      documents: [
        { id: "swe-bench-pro", title: "SWE-Bench Pro: Can AI Agents Solve Long-Horizon Software Engineering Tasks" },
        { id: "swe-evo", title: "SWE-EVO" }
      ]
    },
    {
      id: "foundations-post-training",
      name: "Foundations & Post-Training",
      documents: [
        { id: "post-training-overview", title: "Post Training Overview" }
      ]
    },
    {
      id: "rl-alignment",
      name: "Reinforcement Learning & Alignment",
      documents: [
        { id: "rubric-scaffolded-rl", title: "Breaking the Exploration Bottleneck: Rubric-Scaffolded Reinforcement Learning for General LLM Reasoning" },
        { id: "agentic-rl", title: "Agentic RL" }
      ]
    },
    {
      id: "rubric-evaluation",
      name: "Rubric-Based Evaluation",
      documents: [
        { id: "concept-based-rubrics", title: "Concept-based Rubrics Improve LLM Formative Assessment and Data Synthesis" },
        { id: "open-rubrics", title: "OpenRubrics: Towards Scalable Synthetic Rubric Generation for Reward Modeling and LLM Alignment" },
        { id: "rubicon-evaluation", title: "RUBICON: Rubric-Based Evaluation of Domain-Specific Human" },
        { id: "rubric-code-evaluation", title: "Rubric Is All You Need: Enhancing LLM-based Code Evaluation With Question-Specific Rubrics" }
      ]
    },
    {
      id: "safety-bias-fairness",
      name: "Safety, Bias & Fairness",
      documents: [
        { id: "health-equity-toolbox", title: "A Toolbox for Surfacing Health Equity Harms" }
      ]
    }
  ]
};

const DeepLearning = () => {
  const { docId } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [scale, setScale] = useState(1.3);
  
  // Bookmark state
  const [bookmark, setBookmark] = useState(null);
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [bookmarkRestored, setBookmarkRestored] = useState(false);
  
  // Notes state
  const [notes, setNotes] = useState([]);
  const [showNotesPanel, setShowNotesPanel] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [maximized, setMaximized] = useState(false);

  // Toggle folder expansion
  const toggleFolder = (folderId) => {
    setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  // Select document
  const selectDocument = (doc) => {
    setSelectedDoc(doc);
    setPdfDoc(null);
    setCurrentPage(1);
    setTotalPages(0);
    setBookmark(null);
    setNotes([]);
    setBookmarkRestored(false);
    navigate(`/training/deep-learning/${doc.id}`);
  };

  // Load PDF when document selected
  useEffect(() => {
    if (docId) {
      // Find the document in the library
      for (const folder of DEEP_LEARNING_LIBRARY.folders) {
        const doc = folder.documents.find(d => d.id === docId);
        if (doc) {
          setSelectedDoc(doc);
          break;
        }
      }
    }
  }, [docId]);

  // Load PDF first
  useEffect(() => {
    if (selectedDoc && token) {
      loadPdf();
    }
  }, [selectedDoc, token]);

  // Fetch bookmark and notes after PDF loads
  useEffect(() => {
    if (pdfDoc && selectedDoc && token && !loading) {
      fetchBookmark();
      fetchNotes();
    }
  }, [pdfDoc, selectedDoc, token, loading]);

  const loadPdf = async () => {
    if (!selectedDoc) return;

    try {
      setLoading(true);
      setBookmarkRestored(false);
      const loadingTask = getSecurePdfDocument(selectedDoc.id, token);
      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setLoading(false);
    } catch (error) {
      /* noop */
      toast.error('Failed to load document. Please try again.');
      setLoading(false);
    }
  };

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
      } catch (error) { console.error('fetch failed:', error); }
      setRendering(false);
    };
    
    renderPage();
  }, [pdfDoc, currentPage, scale, maximized]);

  const pageSlug = selectedDoc ? `deep-learning-${selectedDoc.id}` : '';

  const fetchBookmark = async () => {
    if (!pageSlug) return;
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bookmarks/${pageSlug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setBookmark(data.bookmark);
      // Restore page if bookmark exists and not yet restored
      if (data.bookmark && data.bookmark.scroll_position && !bookmarkRestored && totalPages > 0) {
        const savedPage = Math.round(data.bookmark.scroll_position);
        if (savedPage >= 1 && savedPage <= totalPages) {
          setCurrentPage(savedPage);
          setBookmarkRestored(true);
          toast.success(`Restored to page ${savedPage}`);
        }
      }
    } catch (error) { console.error('fetch failed:', error); }
  };

  const fetchNotes = async () => {
    if (!pageSlug) return;
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notes/${pageSlug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setNotes(data.notes || []);
    } catch (error) { console.error('fetch failed:', error); }
  };

  const handleSaveBookmark = async () => {
    setSavingBookmark(true);
    try {
      const pageToSave = Math.round(currentPage);
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
        setBookmarkRestored(true);
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
      toast.success(`Jumped to page ${savedPage}`);
    }
  };

  const handleDeleteBookmark = async () => {
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bookmarks/${pageSlug}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      setBookmark(null);
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

  const goToPrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && maximized) { setMaximized(false); return; }
    if (!selectedDoc) return;
    if (e.key === 'ArrowLeft') goToPrevPage();
    else if (e.key === 'ArrowRight') goToNextPage();
  }, [currentPage, totalPages, selectedDoc, maximized]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleContextMenu = (e) => e.preventDefault();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
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
              <span className="text-foreground">Deep Learning</span>
            </div>

            <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
              {DEEP_LEARNING_LIBRARY.title}
            </h1>
            <p className="text-sm text-foreground-muted mb-6">
              Advanced research papers and documentation for LLM training
            </p>

            <div className="flex gap-6">
              {/* Document Library Sidebar */}
              <div className="w-80 flex-shrink-0">
                <div className="bg-background-card border border-border rounded-xl p-4 sticky top-4">
                  <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <FileText size={16} className="text-primary" />
                    Document Library
                  </h3>
                  
                  <div className="space-y-1">
                    {DEEP_LEARNING_LIBRARY.folders.map((folder) => (
                      <div key={folder.id}>
                        <button
                          onClick={() => toggleFolder(folder.id)}
                          className="w-full flex items-center gap-2 px-2 py-2 text-sm text-foreground hover:bg-secondary rounded-lg transition-colors"
                        >
                          {expandedFolders[folder.id] ? (
                            <FolderOpen size={16} className="text-amber-400" />
                          ) : (
                            <Folder size={16} className="text-amber-400" />
                          )}
                          <span className="flex-1 text-left">{folder.name}</span>
                          <ChevronDown 
                            size={14} 
                            className={`text-foreground-muted transition-transform ${expandedFolders[folder.id] ? 'rotate-180' : ''}`}
                          />
                        </button>
                        
                        <AnimatePresence>
                          {expandedFolders[folder.id] && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="pl-6 space-y-1 py-1">
                                {folder.documents.map((doc) => (
                                  <button
                                    key={doc.id}
                                    onClick={() => selectDocument(doc)}
                                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-lg transition-colors ${
                                      selectedDoc?.id === doc.id
                                        ? 'bg-primary/20 text-primary'
                                        : 'text-foreground-muted hover:bg-secondary hover:text-foreground'
                                    }`}
                                  >
                                    <FileText size={12} />
                                    <span className="text-left line-clamp-2">{doc.title}</span>
                                  </button>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Document Viewer */}
              <div className="flex-1">
                {!selectedDoc ? (
                  <div className="bg-background-card border border-border rounded-xl p-12 text-center">
                    <FileText size={48} className="text-foreground-muted mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">Select a Document</h3>
                    <p className="text-foreground-muted text-sm">
                      Choose a document from the library on the left to start reading
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Document Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <h2 className="text-lg font-semibold text-foreground">{selectedDoc.title}</h2>
                      </div>
                      <div className="flex gap-2">
                        {/* Bookmark Button */}
                        <button
                          onClick={bookmark ? handleGoToBookmark : handleSaveBookmark}
                          disabled={savingBookmark || loading}
                          data-testid="bookmark-button"
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                            bookmark 
                              ? 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30' 
                              : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
                          }`}
                        >
                          {bookmark ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
                          <span>{bookmark ? `Page ${bookmark.scroll_position}` : 'Bookmark'}</span>
                        </button>

                        {bookmark && (
                          <button onClick={handleDeleteBookmark} className="p-1.5 text-foreground-muted hover:text-red-400">
                            <X size={16} />
                          </button>
                        )}
                        
                        {/* Notes Toggle */}
                        <button
                          onClick={() => setShowNotesPanel(!showNotesPanel)}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                            showNotesPanel 
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
                              : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
                          }`}
                        >
                          <StickyNote size={16} />
                          <span>Notes</span>
                          {notes.length > 0 && (
                            <span className="bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">{notes.length}</span>
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
                          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                            <div className="flex gap-2 mb-3">
                              <input
                                value={newNoteContent}
                                onChange={(e) => setNewNoteContent(e.target.value)}
                                placeholder={`Add note for page ${currentPage}...`}
                                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm"
                                onKeyDown={(e) => e.key === 'Enter' && handleAddNote()}
                              />
                              <button
                                onClick={handleAddNote}
                                disabled={!newNoteContent.trim() || savingNote}
                                className="px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-50"
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                            <div className="space-y-2 max-h-32 overflow-y-auto">
                              {notes.length === 0 ? (
                                <p className="text-foreground-muted text-center text-sm py-2">No notes yet</p>
                              ) : (
                                notes.map((note) => (
                                  <div key={note.id} className="flex justify-between items-start bg-background rounded-lg p-2 text-sm">
                                    <span className="text-foreground">{note.content}</span>
                                    <button onClick={() => handleDeleteNote(note.id)} className="text-foreground-muted hover:text-red-400 ml-2">
                                      <X size={12} />
                                    </button>
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
                      <div className={`px-4 py-2.5 border-b flex items-center justify-between shrink-0 ${maximized ? 'bg-background-card border-border' : 'bg-gradient-to-r from-primary/10 to-transparent border-border'}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          {maximized && <FileText size={16} className="text-primary shrink-0" />}
                          {maximized && <span className="font-medium text-foreground truncate">{selectedDoc?.title}</span>}
                          <span className="text-xs text-foreground-muted">Read-Only</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {maximized && (
                            <div className="flex items-center gap-2 bg-secondary px-3 py-1.5 rounded-lg">
                              <button onClick={goToPrevPage} disabled={currentPage <= 1} className="text-foreground-muted hover:text-foreground disabled:opacity-30"><ChevronLeft size={18} /></button>
                              <span className="text-sm text-foreground">Page</span>
                              <input type="number" min={1} max={totalPages} value={currentPage} onChange={(e) => { const p = parseInt(e.target.value); if (p >= 1 && p <= totalPages) setCurrentPage(p); }} className="w-14 px-2 py-0.5 bg-background border border-border rounded text-center text-foreground text-sm" />
                              <span className="text-sm text-foreground-muted">of {totalPages}</span>
                              <button onClick={goToNextPage} disabled={currentPage >= totalPages} className="text-foreground-muted hover:text-foreground disabled:opacity-30"><ChevronRight size={18} /></button>
                            </div>
                          )}
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
                                <button onClick={goToPrevPage} disabled={currentPage <= 1} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-40"><ChevronLeft size={18} />Prev</button>
                                <div className="flex items-center gap-2 bg-secondary px-3 py-1.5 rounded-lg">
                                  <span className="text-foreground text-sm">Page</span>
                                  <input type="number" min={1} max={totalPages} value={currentPage} onChange={(e) => { const pg = parseInt(e.target.value); if (pg >= 1 && pg <= totalPages) setCurrentPage(pg); }} className="w-14 px-2 py-1 bg-background border border-border rounded text-center text-foreground text-sm" />
                                  <span className="text-foreground-muted text-sm">of {totalPages}</span>
                                </div>
                                <button onClick={goToNextPage} disabled={currentPage >= totalPages} className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm disabled:opacity-40">Next<ChevronRight size={18} /></button>
                              </div>
                            )}
                            <div className="relative">
                              <canvas ref={canvasRef} className="shadow-xl rounded-lg" style={maximized ? { maxHeight: 'calc(100vh - 80px)', width: 'auto' } : { maxWidth: '100%', height: 'auto' }} />
                              {rendering && (
                                <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg">
                                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                      {!maximized && (
                        <div className="bg-background px-4 py-2 text-center border-t border-border">
                          <span className="text-xs text-foreground-muted">Internal document - Read-only</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default DeepLearning;
