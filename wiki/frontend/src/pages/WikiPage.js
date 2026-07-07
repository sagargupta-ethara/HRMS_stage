import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import DOMPurify from 'dompurify';
import Sidebar from '../components/Sidebar';
import LeavePolicyView from '../components/LeavePolicyView';
import { useAuth } from '../context/AuthContext';
import { Edit, Trash2, ChevronRight, Clock, User, Bookmark, BookmarkCheck, StickyNote, Plus, X, Download, Save, Maximize2, Minimize2, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';

const WikiPage = () => {
  const { slug } = useParams();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  
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
  
  // Feedback state
  const [feedbackList, setFeedbackList] = useState([]);
  const [feedbackInput, setFeedbackInput] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const contentRef = useRef(null);
  const mainRef = useRef(null);
  const contentHtmlRef = useRef(null);

  const DIAGRAMS_NET_URL = "https://viewer.diagrams.net/?tags=%7B%7D&lightbox=1&highlight=0000ff&layers=1&nav=1&title=Flowchart%20Roles.drawio&dark=auto";
  const DIAGRAM_HASH = "#R%3Cmxfile%3E%3Cdiagram%20id%3D%22v74kPseO_o2rWq0N1N39%22%20name%3D%22Roles%20Flowchart%22%3E7V1Zd%2BI4Fv41Pqf7ITnW5uWRSqjlTKU7U8k5Mz1vbqMCTxuLMSZL%2F%2FqxwQIvhErB1XVE1Ut1W9gOfHf%2FdCU57Gr%2B9CGPFrMbNZGpQ93Jk8OuHUoD1%2FXL%2F1Qjz5sR4VF3MzLNk8lmjOwG7pK%2FZT2ob1slE7ls3VgolRbJoj0YqyyTcdEai%2FJcPbZv%2B6rS9l9dRFPZG7iLo7Q%2F%2Bq9kUszqHybc3fhHmUxn%2Bi8Tt%2F5kHumb64HlLJqox8YQGzvsKleq2Pzf%2FOlKphV6GpfNc%2B9f%2BHT7xXKZFa95oMgX%2F1l%2BmOUqVg%2F%2FmMVSZjc3F3veUg8ti2eNweMsKeTdIoqr68dS0A57tyxy9dcWkvLHvPuqsqKWH%2FHL681rHqJ0Vb9mXMyiPCrHRp8c6jmUlTJm7z7LaCLz5SxZ1A%2FIvJBPja9S%2F5oPUs1lkT%2BXt8wagAd889jjTjhEsM1Y%2FRYaVFfVQK2EF1uZRLV2TLcv3wFY%2Fk%2BN4ffg6dV%2FSk56etWHWK3yWB54G%2B2JonrtXX2p8mKmpiqL0vFu9F2uVtlEVt%2BxQnd3z2elFpVoysH%2FyqJ4rkUVrQpVDs2KeVp%2FKp%2BS4t%2FV45eivvqj8cn1U%2F3m9cWzvshK8BoPVZd%2FND%2FbPba%2B0s%2Ft15kiyqeyOIAL268XuUyjInlo4w4uYopoMre5mubRvBy8lmn5y9Y%2F8zp5SJaJyqDshXpuy14uCA1b9kICU1gSEQKaC%2BuJwSpj%2BLZtx6v8Yf1ryPG2I4a0HaJV7a3L%2B8K9dElD4u6lJ8RhqX%2Bf9Kpnb2WelLjK%2FDRvyIeUKEP0hh%2FLVKEcUV%2FLf%2FZ5RlPukLktd8iIuBSmDIQzQAPhP%2FOHvbgEg%2FpAzn9EER8pKn9YUYmfonq1qMIhRcUR49C9jGdZEkfpUSFH%2BL2QQ1jYDjk%2BDXWIqYMOD4yVrAIyJxO2KDlyyCF8WE8myE8hIwh52MxCQJJPP4X8kpAHDXQCMdDd3Y9vwGKcy9sxTitrHeA811yA8wDNwvtpFi%2BgPCgrS7TK%2FVhCPlpYg5JGRAQ%2ForDQLXJQrtdDDFS%2FqewCNFj5fitYcdKmALnPDaHmI6K241Bvoiyayvwo%2BF5FobphG0DPpYYADBABbBABbh%2FMK%2BqMXGOQ%2Bj1ETRlyiJlxqnRVJCpblsOjPK5eGhdONV3%2F3tk0DrjNW6rmAcM4C9LF2VzvACLQ11FRtWL8vpB5pNE0PbFMtgN6YtkLTGGJ6Ueb81J7cEUCkxFjk1ID%2BVQz5Cpxu8HcY6aAQ3WdBot1wliAhBl1ETGr8sYqpBhMHYlHCBZ0mN18rciBkvKEom23IjAGJEUE8p%2BrKE2KZ5Rspguhz4x1yWE2huwg%2FCIfEvlorpLpAhiEpuoYijqjGS3%2FkvnyBOXb4wm3XbYaO7%2BT%2FbnCmAFjsuT4nrCX%2Bxl0hZhFyZWaz1fZxpKHAdKgQ8SsSMBiyl6z7uTT1PdaGIauqUKEYhYie4IKri4SV1cu8EBiFiY6uEAl2IHo4Ba2axNCfFPekGEWJ3vjiinlEz5WRGGYVQp%2BROkCaS6isHOtUnoYmsuy2XmWKT0EDcYSNkShQt1ffquIandLF%2F4KFV%2BonpzeYdkmcEzGF8y6ZT2b8kUuZZTHM6cq1rxovljf6eqVvOPq%2FnUQchDmBwLeziTNzQ8wzLKmOT9wCPQm2EgIm5s0YJj1ThfVcTZNMnmkf93nE1jHJwT6JuOkLsOsea7VPEoqUx8%2FlclnAZez6wC%2BxS%2FopJuhbwo%2FzFLnNleTVT1h3bDrWhuTbIrgRem239G4F%2BWY5VBn9d%2B3cEYC15wD5Zh10p36WjyWf8iE7ySiA6HfXl5uzndyzArpWj78vliaAFD3Sm0BDNprg8w5T45ZHu2M%2BhSy4xgAfW6qnY9jFkfjrJD5Ik%2BWsuMYP6gSxGxefQPq3kWpPLnbh%2BhJ7UO%2BknudQCSMwYxZNzUDkQazifZtlBfZZksbY90%2FPWwNxiHMUmkUx2q1VtPxk4xX6y5lsDjkdyAMsHpaOGYtdFfkUSGnSdxTRdMkck8pzZHIHLMq%2BriaR1VRVBaY67UIGL2S1PfRsnjMCqnpPPfgigSmOW8pMEui%2BzL6rJ3lKP7fqlTHmqc7zXUegyfXOgSPJ2YVNJ4vUvUs6yqodJV1ytSM7lertFhtCiV0mM35U70YE8cHfHFO7pDeOzHcgS8gbfjMpfkCs076kKvHYnZqDNrL0rW7fhkh7Urd3EZwArNOasYgDSYUgrSDIG3znIwac5SoJVBSk5nbjNJ1xtQpDTBkp4H6CrfI3AAt%2BmDWPvd5lGT15KbmkJZw05q0PYXBiGZFjLNIArP8eZ9kURZLI%2B6xgyDvdPYbdI%2Bo5U7DPW7RhILQ70LYVkKD%2FhGzyqlpjCgDnELzOsGZUyz6wsOsaTYal2zW1KZRlm0CTTMFH2VR%2BrxM1o7y%2Fe32k9FxvvI1EYd1pyuNJeIeZr1Tq2kF5G30HP2ZdonjLzKWycPmAyRozfXL6a25UaD9LKdrFQYPQrok1Pj5tD2XYS4IeZhFTjMI1VhCASi6AHa4IWMhyMMscrQCjpZLVbrTAi6GB34XQKz1tB5mjaMBvJNZonITSFLesWUvxOqK8ZCX9SzSxFBW3l2OwkKBlZV7Q20y0ATUUHUYdrZnM%2BgVMWubT%2FcmYjJve0ROGZoKDjV3UwEJhZ53GD1zqudjFjZr1QOf1e6WhZzStuGai8Y%2BZqmyRm8biuGbA%2FR69e2GXyFDCsV%2BLS%2BQvfD6%2BLdOnVgWUV6MqmOxyoFMZeU972Q20SN%2Fpir%2By2lsbuc0T8AQ1Hl5Dzt9YEZ7Y70jd66jPfHvF%2BqrN7JbP1r%2Byui5ccNCJTU%2FU7%2F5thpo6EB3PWbth3bC3rxxJ%2FrtVztBGyD3Ku0fkHKKNrTPQwnYd2vDt7dlPFJfPGh9OW0HOkgRGjVojmXQBFxCR1k0YeEAJq3rZRh96O92epJCtLYvdS%2FD8IBKuGDq4COrQ8ueIUQKuX%2BtRsOIjR%2Fhpo8VavA2bNztEMq83knHrI2Hb1gh%2BlsUo%2BhDaLmR61jxFmV6ci52bGbuIgv1BSP33QGMPCSQChGcQSDXv9ZeG4csvvewHxb6bc0f2StTyCMUNRpDmCmsWJntYoU8NpHCUiMDipXbLlbIIxZ1zml3UBW2ixSSAKP9c8hsDKrYBBi4TCFJLHoOJBa1ncQKIUksOhRnASdPbP4KXJ6QHBQ1WZ7iyNN2%2Fom4kASUZm6s9rkMm36Clykkh8RMyhQtN9LtPhYLFZJF0nBYX5rq%2FWktliskk6ThsNsB284ibU82gpGpSRoJJUtitvNHxAUlkGDl2bJQ4aN5XmwG6YVZurC7hw1Guw1xQVvoTNJPaF7bdvaJuJD0EzNJP%2BGlzbbzT8SFJKCYSQIKNW22nYciLmgzlMGI7KHJFJuL2h%2BQKQ2GCMgEksfSUFodkLn1PJbe%2BgREpvwseCy9YbfFQoXksTiw5x4sIOtdxC2WKySPpeGw2wFbz2MRSB7LZJJ1iPWAkyc2jfVCgiXCQRIsSApMQ2kvp8ltb6AiBJLC4mfRQcWt57AIJIfFz6GFiltPYRHQhYBnYafW01e6iRjGTs9hmY%2FeX9demVJICkrDYW%2BGJKznn%2FR3ARGoGIp%2FghOo9dwTheSexFChFE6g1pNOFJJ0gpbnJm7ichQCm3Paz1EwSobgKCgkXyWG6rsCTZWF9b1XFJJ4EiaJJ6xUWVjPPVFI7kmcBfckrOeeKOgeVGaD8aGuDDg7xaaeXgjGggywIxmhkLSVOIvtioT1vJVe8AYj1AF5K1i5Ws9dMUjuSsNhdZLlWU9f6UVeIDL1zqJ9Sp98Y7FQISksw0nWwcUocIaKzWK9kGUFugMKNctikAyYhtJyI7e%2B74pB8lieSR4LM8vyrKeyGCSV5Q1IZcHK1Xo6i73h3dh7QVkckCtcUH4bm7Fz1xtiHoJBMmHeWawk9Kxvw2JvuQ2ra%2BSHTl2AM%2FK3sRs7Z3q%2FBVwjh6TCvKG2woI1cut5MA7Jg2k4rM%2FQfOu5ML1QDESu%2FoDbnMHK1Xo6jGMej3mbq2kezcvBmyiLpjJ3rqgz0rYBfmz1Be8ceuv7po7ZIxzzgMx7Gc%2ByJN4cv46M6ZYw22J6QJtPxDRExPROpasiUVl1zvooj6uXxlWOVP2GcuRT%2BU%2Fzls%2FVMZsnIE37SPttpEmn8vL15%2FBA606tc3QCQXDZPnvd070zBnDEPDt8QCfAPExQMc8TP8YLUPeXrSx%2BPQ7yPWeddiD3eB9y8d2Ql5e5UkUzhyihmt2oiazu%2BD8%3D%3C%2Fdiagram%3E%3C%2Fmxfile%3E";

  const OrgChartEmbed = () => {
    const [chartFullscreen, setChartFullscreen] = useState(false);
    const iframeUrl = DIAGRAMS_NET_URL + DIAGRAM_HASH;

    if (chartFullscreen) {
      return (
        <div className="fixed inset-0 z-50 bg-background p-4" data-testid="org-chart-embed">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-foreground-muted">Interactive Organization Chart</h3>
            <button
              onClick={() => setChartFullscreen(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
              data-testid="org-chart-fullscreen-btn"
            >
              <Minimize2 size={14} />
              Exit Fullscreen
            </button>
          </div>
          <div className="rounded-xl overflow-hidden border border-primary/20" style={{ height: 'calc(100vh - 80px)' }}>
            <iframe
              src={iframeUrl}
              title="Ethara AI Organization Flowchart"
              style={{ width: '100%', height: '100%', border: 'none', background: '#19182C' }}
              allowFullScreen
              data-testid="org-chart-iframe"
            />
          </div>
        </div>
      );
    }

    return (
      <div className="mt-6" data-testid="org-chart-embed">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-foreground-muted">Interactive Organization Chart</h3>
          <button
            onClick={() => setChartFullscreen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
            data-testid="org-chart-fullscreen-btn"
          >
            <Maximize2 size={14} />
            Fullscreen
          </button>
        </div>
        <div className="rounded-xl overflow-hidden border border-primary/20" style={{ height: '600px' }}>
          <iframe
            src={iframeUrl}
            title="Ethara AI Organization Flowchart"
            style={{ width: '100%', height: '100%', border: 'none', background: '#19182C' }}
            allowFullScreen
            data-testid="org-chart-iframe"
          />
        </div>
      </div>
    );
  };

  // Track time spent on page
  const pageEntryTime = useRef(null);
  useEffect(() => {
    pageEntryTime.current = Date.now();
    const trackExit = () => {
      if (pageEntryTime.current && page) {
        const duration = Math.round((Date.now() - pageEntryTime.current) / 1000);
        if (duration >= 3 && token) {
          fetch(`${process.env.REACT_APP_BACKEND_URL}/api/activity/track-duration`, {
            method: 'POST', keepalive: true,
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ page_slug: slug, page_title: page?.title || slug, duration_seconds: duration })
          }).catch(() => {});
        }
      }
    };
    window.addEventListener('beforeunload', trackExit);
    return () => { window.removeEventListener('beforeunload', trackExit); trackExit(); };
  }, [slug, page, token]);

  // Restore scroll position when bookmark exists
  useEffect(() => {
    if (bookmark && contentRef.current && mainRef.current) {
      const scrollContainer = mainRef.current;
      const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const targetPosition = (bookmark.scroll_position / 100) * scrollHeight;
      
      setTimeout(() => {
        scrollContainer.scrollTo({ top: targetPosition, behavior: 'smooth' });
        toast.success('Restored to your bookmarked position');
      }, 500);
    }
  }, [bookmark, page]);

  const fetchPage = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/wiki/pages/${slug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setPage(data.page);
    } catch (error) {
      toast.error('Failed to fetch page');
    } finally {
      setLoading(false);
    }
  }, [slug, token]);

  const fetchBookmark = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bookmarks/${slug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setBookmark(data.bookmark);
    } catch (error) {
      console.error('fetch failed:', error);
    }
  }, [slug, token]);

  const fetchNotes = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notes/${slug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setNotes(data.notes || []);
    } catch (error) {
      console.error('fetch failed:', error);
    }
  }, [slug, token]);

  const fetchFeedback = useCallback(async () => {
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/feedback/${slug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setFeedbackList(data.feedback || []);
    } catch (e) {
      console.error('fetch failed:', e);
    }
  }, [slug, token]);

  useEffect(() => {
    fetchPage();
    fetchBookmark();
    fetchNotes();
    fetchFeedback();
  }, [fetchPage, fetchBookmark, fetchNotes, fetchFeedback]);

  const handleSubmitFeedback = async () => {
    if (!feedbackInput.trim()) return;
    setSubmittingFeedback(true);
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/feedback`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_slug: slug, comment: feedbackInput.trim() })
      });
      if (res.ok) {
        setFeedbackInput('');
        fetchFeedback();
        toast.success('Feedback submitted');
      }
    } catch (e) { toast.error('Failed to submit feedback'); }
    finally { setSubmittingFeedback(false); }
  };

  const handleDeleteFeedback = async (timestamp) => {
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/feedback/${slug}/${encodeURIComponent(timestamp)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) { fetchFeedback(); toast.success('Feedback deleted'); }
      else { const d = await res.json(); toast.error(d.detail || 'Failed to delete'); }
    } catch (e) { toast.error('Failed to delete feedback'); }
  };

  const handleSaveBookmark = useCallback(async () => {
    if (!mainRef.current) return;
    
    setSavingBookmark(true);
    const scrollContainer = mainRef.current;
    const scrollHeight = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    const scrollPosition = scrollHeight > 0 ? (scrollContainer.scrollTop / scrollHeight) * 100 : 0;
    
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bookmarks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          page_slug: slug,
          scroll_position: scrollPosition
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setBookmark({ scroll_position: data.scroll_position, page_slug: slug });
        toast.success('Reading position saved!');
      }
    } catch (error) {
      toast.error('Failed to save bookmark');
    } finally {
      setSavingBookmark(false);
    }
  }, [slug, token]);

  const handleDeleteBookmark = async () => {
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/bookmarks/${slug}`, {
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
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          page_slug: slug,
          content: newNoteContent.trim()
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

  const handleExportPDF = async () => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/notes/${slug}/export`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      
      // Generate PDF-style HTML content
      const pdfContent = `
<!DOCTYPE html>
<html>
<head>
  <title>${data.page.title} - Notes</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; line-height: 1.6; }
    h1 { color: #1a1a2e; border-bottom: 3px solid #0ea5a5; padding-bottom: 10px; }
    h2 { color: #0ea5a5; margin-top: 30px; }
    .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
    .page-content { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .notes-section { margin-top: 30px; }
    .note { background: #fffde7; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0; border-radius: 0 8px 8px 0; }
    .note-date { color: #888; font-size: 12px; margin-top: 10px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${data.page.title}</h1>
  <div class="meta">
    <strong>Category:</strong> ${data.page.category} ${data.page.subcategory ? `/ ${data.page.subcategory}` : ''}<br>
    <strong>Exported by:</strong> ${data.user_name}<br>
    <strong>Date:</strong> ${new Date(data.exported_at).toLocaleString()}
  </div>
  
  <h2>Page Content</h2>
  <div class="page-content">
    ${data.page.content_text.replace(/\n/g, '<br>')}
  </div>
  
  <div class="notes-section">
    <h2>Your Notes (${data.notes.length})</h2>
    ${data.notes.length > 0 ? data.notes.map(note => `
      <div class="note">
        ${note.content.replace(/\n/g, '<br>')}
        <div class="note-date">Added: ${new Date(note.created_at).toLocaleString()}</div>
      </div>
    `).join('') : '<p>No notes yet.</p>'}
  </div>
  
  <div class="footer">
    Generated from Ethara Wiki • ${new Date().toLocaleDateString()}
  </div>
</body>
</html>`;
      
      // Create and download the file
      const blob = new Blob([pdfContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.page.title.replace(/[^a-z0-9]/gi, '_')}_notes.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast.success('Notes exported! Open the HTML file in browser and print as PDF.');
    } catch (error) {
      toast.error('Failed to export notes');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this page?')) return;
    
    setDeleting(true);
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/wiki/pages/${slug}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        toast.success('Page deleted successfully');
        navigate(`/wiki/${page.category}`);
      } else {
        toast.error('Failed to delete page');
      }
    } catch (error) {
      toast.error('Failed to delete page');
    } finally {
      setDeleting(false);
    }
  };

  const canEdit = user?.role === 'admin';
  const canDelete = user?.role === 'admin';

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

  if (!page) {
    return (
      <div className="flex">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-foreground mb-4">Page not found</h2>
            <button
              onClick={() => navigate('/dashboard')}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      
      <main ref={mainRef} className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-8" ref={contentRef}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center text-sm text-foreground-muted mb-6">
              <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/dashboard')}>Home</span>
              <ChevronRight size={16} className="mx-2" />
              <span className="cursor-pointer hover:text-primary capitalize" onClick={() => navigate(`/wiki/${page.category}`)}>{page.category}</span>
              <ChevronRight size={16} className="mx-2" />
              <span className="text-foreground">{page.title}</span>
            </div>

            <div className="flex items-start justify-between mb-6">
              <div className="flex-1">
                <h1 className="text-4xl font-heading font-bold text-foreground mb-4" data-testid="page-title">{page.title}</h1>
                <div className="flex flex-wrap items-center gap-4 text-sm text-foreground-muted">
                  <div className="flex items-center space-x-2">
                    <Clock size={16} />
                    <span>Updated {new Date(page.updated_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <User size={16} />
                    <span>by {page.updated_by}</span>
                  </div>
                  {page.subcategory && (
                    <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs">{page.subcategory}</span>
                  )}
                </div>
              </div>

              <div className="flex space-x-2">
                {/* Bookmark & Notes - hidden for specific wiki pages */}
                {!['core-values', 'what-we-do', 'organization-chart', 'leave-policy', 'code-of-conduct'].includes(slug) && (
                  <>
                    {/* Bookmark Button */}
                    <button
                      onClick={bookmark ? handleDeleteBookmark : handleSaveBookmark}
                      disabled={savingBookmark}
                      data-testid="bookmark-button"
                      className={`flex items-center space-x-2 px-4 py-2 rounded-lg border transition-colors ${
                        bookmark 
                          ? 'bg-primary/20 text-primary border-primary/30 hover:bg-primary/30' 
                          : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
                      }`}
                      title={bookmark ? 'Remove bookmark' : 'Save reading position'}
                    >
                      {bookmark ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
                      <span className="hidden sm:inline">{savingBookmark ? 'Saving...' : (bookmark ? 'Bookmarked' : 'Bookmark')}</span>
                    </button>
                
                    {/* Notes Panel Toggle */}
                    <button
                      onClick={() => setShowNotesPanel(!showNotesPanel)}
                      data-testid="notes-toggle-button"
                      className={`flex items-center space-x-2 px-4 py-2 rounded-lg border transition-colors ${
                        showNotesPanel 
                          ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' 
                          : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
                      }`}
                    >
                      <StickyNote size={18} />
                      <span className="hidden sm:inline">Notes</span>
                      {notes.length > 0 && (
                        <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">{notes.length}</span>
                      )}
                    </button>
                  </>
                )}

                {(canEdit || canDelete) && (
                  <>
                    {canEdit && (
                      <button
                        onClick={() => navigate(`/wiki/edit/${slug}`)}
                        data-testid="edit-page-button"
                        className="flex items-center space-x-2 px-4 py-2 bg-secondary text-foreground rounded-lg hover:bg-secondary/80 border border-border transition-colors"
                      >
                        <Edit size={18} />
                        <span className="hidden sm:inline">Edit</span>
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={handleDelete}
                        disabled={deleting}
                        data-testid="delete-page-button"
                        className="flex items-center space-x-2 px-4 py-2 bg-red-500/10 text-red-400 rounded-lg hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50"
                      >
                        <Trash2 size={18} />
                        <span className="hidden sm:inline">{deleting ? 'Deleting...' : 'Delete'}</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Notes Panel */}
            <AnimatePresence>
              {showNotesPanel && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-6 overflow-hidden"
                >
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-6" data-testid="notes-panel">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <StickyNote size={20} className="text-amber-400" />
                        Your Notes
                      </h3>
                      {notes.length > 0 && (
                        <button
                          onClick={handleExportPDF}
                          data-testid="export-pdf-button"
                          className="flex items-center space-x-2 px-3 py-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors text-sm"
                        >
                          <Download size={16} />
                          <span>Export as PDF</span>
                        </button>
                      )}
                    </div>
                    
                    {/* Add New Note */}
                    <div className="mb-4">
                      <textarea
                        value={newNoteContent}
                        onChange={(e) => setNewNoteContent(e.target.value)}
                        placeholder="Write a note about this page..."
                        className="w-full px-4 py-3 bg-background border border-border rounded-lg text-foreground placeholder-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                        rows={3}
                        data-testid="new-note-input"
                      />
                      <div className="flex justify-end mt-2">
                        <button
                          onClick={handleAddNote}
                          disabled={!newNoteContent.trim() || savingNote}
                          data-testid="add-note-button"
                          className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Plus size={18} />
                          <span>{savingNote ? 'Saving...' : 'Add Note'}</span>
                        </button>
                      </div>
                    </div>
                    
                    {/* Notes List */}
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {notes.length === 0 ? (
                        <p className="text-foreground-muted text-center py-4">No notes yet. Start writing!</p>
                      ) : (
                        notes.map((note) => (
                          <div
                            key={note.id}
                            className="bg-background border border-border rounded-lg p-4"
                            data-testid={`note-item-${note.id}`}
                          >
                            {editingNoteId === note.id ? (
                              <div>
                                <textarea
                                  value={editingNoteContent}
                                  onChange={(e) => setEditingNoteContent(e.target.value)}
                                  className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                                  rows={3}
                                  data-testid={`edit-note-input-${note.id}`}
                                />
                                <div className="flex justify-end gap-2 mt-2">
                                  <button
                                    onClick={() => { setEditingNoteId(null); setEditingNoteContent(''); }}
                                    className="px-3 py-1.5 text-foreground-muted hover:text-foreground transition-colors"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    onClick={() => handleUpdateNote(note.id)}
                                    disabled={savingNote}
                                    className="flex items-center space-x-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover transition-colors"
                                  >
                                    <Save size={14} />
                                    <span>Save</span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="text-foreground whitespace-pre-wrap">{note.content}</p>
                                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                                  <span className="text-xs text-foreground-muted">
                                    {new Date(note.created_at).toLocaleString()}
                                  </span>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => { setEditingNoteId(note.id); setEditingNoteContent(note.content); }}
                                      className="text-foreground-muted hover:text-primary transition-colors"
                                      data-testid={`edit-note-button-${note.id}`}
                                    >
                                      <Edit size={14} />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteNote(note.id)}
                                      className="text-foreground-muted hover:text-red-400 transition-colors"
                                      data-testid={`delete-note-button-${note.id}`}
                                    >
                                      <X size={14} />
                                    </button>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="bg-background-card border border-border rounded-xl p-8">
              {slug === 'leave-policy' ? (
                <LeavePolicyView />
              ) : (
                <div 
                  className="prose prose-invert max-w-none tiptap"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.content_html, { ADD_TAGS: ['iframe'], ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'target'] }) }}
                  data-testid="page-content"
                  ref={contentHtmlRef}
                />
              )}
            </div>

            {/* Feedback Section */}
            <div className="glass-card rounded-xl p-6 mt-6" data-testid="feedback-section">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare size={16} className="text-primary" />
                <h3 className="text-sm font-heading font-semibold text-foreground">Feedback</h3>
                <span className="text-[10px] text-foreground-muted ml-1">{feedbackList.length} comment{feedbackList.length !== 1 ? 's' : ''}</span>
              </div>

              {/* Input */}
              <div className="flex gap-2 mb-5">
                <input
                  type="text"
                  value={feedbackInput}
                  onChange={(e) => setFeedbackInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSubmitFeedback()}
                  placeholder="Share your feedback on this page..."
                  data-testid="feedback-input"
                  className="flex-1 px-4 py-2.5 bg-secondary border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 text-foreground placeholder:text-foreground-muted text-sm"
                  disabled={submittingFeedback}
                />
                <button
                  onClick={handleSubmitFeedback}
                  disabled={submittingFeedback || !feedbackInput.trim()}
                  data-testid="feedback-submit-btn"
                  className="px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Send size={16} />
                </button>
              </div>

              {/* List */}
              {feedbackList.length === 0 ? (
                <p className="text-xs text-foreground-muted text-center py-4">No feedback yet. Be the first to share your thoughts!</p>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {feedbackList.map((fb, i) => (
                    <div key={fb.created_at + i} className="py-3 px-4 rounded-lg bg-[rgba(144,141,206,0.10)] group" data-testid={`feedback-item-${i}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                            {fb.user_name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <span className="text-xs font-medium text-foreground">{fb.user_name}</span>
                          <span className="text-[10px] text-foreground-muted">{fb.user_role}</span>
                          <span className="text-[10px] text-foreground-muted">&middot;</span>
                          <span className="text-[10px] text-foreground-muted">{new Date(fb.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        {(fb.user_email === user?.email || user?.role === 'admin') && (
                          <button
                            onClick={() => handleDeleteFeedback(fb.created_at)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-foreground-muted hover:text-red-400 transition-all"
                            data-testid={`feedback-delete-${i}`}
                            title="Delete feedback"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <p className="text-sm text-foreground leading-relaxed ml-8">{fb.comment}</p>
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

export default WikiPage;
