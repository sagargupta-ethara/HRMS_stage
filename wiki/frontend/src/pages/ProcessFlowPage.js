import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';
import { ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { getSecurePdfDocument } from '../lib/pdfDocument';

const ProcessFlowPage = () => {
  const { token } = useAuth();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [imageUrl, setImageUrl] = useState(null);

  useEffect(() => {
    const renderPdfAsImage = async () => {
      try {
        setLoading(true);
        const pdf = await getSecurePdfDocument('process-flow', token).promise;
        const page = await pdf.getPage(1);
        const scale = 2.0;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        // Crop bottom to remove "Made with Napkin" watermark and excess whitespace
        // The flowchart content ends at roughly 55% of the page height
        const cropRatio = 0.58;
        const cropHeight = Math.floor(viewport.height * cropRatio);
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = viewport.width;
        croppedCanvas.height = cropHeight;
        croppedCanvas.getContext('2d').drawImage(canvas, 0, 0, viewport.width, cropHeight, 0, 0, viewport.width, cropHeight);
        setImageUrl(croppedCanvas.toDataURL('image/png'));
      } catch (error) {
        /* noop */
        toast.error('Failed to load process flow');
      } finally {
        setLoading(false);
      }
    };
    if (token) renderPdfAsImage();
  }, [token]);

  const handleContextMenu = (e) => e.preventDefault();

  useEffect(() => {
    const preventDownload = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'p')) e.preventDefault();
    };
    document.addEventListener('keydown', preventDownload);
    return () => document.removeEventListener('keydown', preventDownload);
  }, []);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-8">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center text-sm text-foreground-muted mb-4">
              <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/dashboard')}>Home</span>
              <ChevronRight size={16} className="mx-2" />
              <span className="cursor-pointer hover:text-primary" onClick={() => navigate('/wiki/operations')}>Operations</span>
              <ChevronRight size={16} className="mx-2" />
              <span className="text-foreground">Process Flow</span>
            </div>

            <div className="mb-6">
              <h1 className="text-2xl font-heading font-bold text-foreground mb-1" data-testid="process-flow-page-title">
                Process Flow
              </h1>
              <p className="text-sm text-foreground-muted">Operations process documentation</p>
            </div>

            <div
              className="bg-background-card border border-border rounded-xl overflow-hidden"
              onContextMenu={handleContextMenu}
              style={{ userSelect: 'none' }}
            >
              <div className="bg-gradient-to-r from-primary/10 to-transparent px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-primary font-medium">Process Flow</span>
                  <span className="text-xs text-foreground-muted">Read-Only</span>
                </div>
              </div>

              <div className="flex flex-col items-center bg-background p-6">
                {loading ? (
                  <div className="flex items-center justify-center h-96">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
                      <p className="text-foreground-muted">Loading process flow...</p>
                    </div>
                  </div>
                ) : imageUrl ? (
                  <img
                    src={imageUrl}
                    alt="Process Flow"
                    data-testid="process-flow-image"
                    className="rounded-lg shadow-2xl"
                    style={{ maxWidth: '100%', height: 'auto' }}
                    draggable={false}
                  />
                ) : (
                  <div className="flex items-center justify-center h-96">
                    <p className="text-foreground-muted">Failed to load process flow image</p>
                  </div>
                )}
              </div>

              <div className="bg-background px-4 py-2 text-center border-t border-border">
                <span className="text-xs text-foreground-muted">Internal operations document - Downloading prohibited</span>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default ProcessFlowPage;
