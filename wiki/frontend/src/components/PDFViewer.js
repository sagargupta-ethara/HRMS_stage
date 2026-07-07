import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PDFViewer = ({ url, title = "Document" }) => {
  // Prevent right-click context menu
  const handleContextMenu = (e) => {
    e.preventDefault();
    return false;
  };

  // Prevent keyboard shortcuts
  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'p')) {
      e.preventDefault();
      return false;
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div 
      className="pdf-viewer-container" 
      style={{
        border: '2px solid #272645',
        borderRadius: '12px',
        overflow: 'hidden',
        background: '#19182C',
        userSelect: 'none'
      }}
      onContextMenu={handleContextMenu}
    >
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #21203A 0%, #19182C 100%)',
        padding: '12px 20px',
        borderBottom: '1px solid #272645',
        display: 'flex',
        alignItems: 'center',
        gap: '12px'
      }}>
        <span style={{ color: '#ED00ED', fontSize: '20px' }}>📖</span>
        <span style={{ color: '#C5CBE8', fontWeight: '600' }}>{title}</span>
        <span style={{ marginLeft: 'auto', color: '#8E93B8', fontSize: '12px' }}>
          Read-Only • Internal Use Only
        </span>
      </div>

      {/* PDF Content using object tag with disabled toolbar */}
      <div 
        style={{
          height: '750px',
          overflow: 'hidden',
          background: '#21203A',
          position: 'relative'
        }}
      >
        <object 
          data={`${url}#toolbar=0&navpanes=0&scrollbar=1&view=FitH&statusbar=0`}
          type="application/pdf"
          style={{
            width: '100%',
            height: '100%',
            border: 'none'
          }}
        >
          <iframe
            src={`${url}#toolbar=0&navpanes=0&scrollbar=1`}
            style={{
              width: '100%',
              height: '100%',
              border: 'none'
            }}
            title={title}
          />
        </object>
        
        {/* Overlay to prevent interactions with PDF controls */}
        <div 
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: '50px',
            height: '50px',
            background: 'transparent',
            zIndex: 10
          }}
        />
      </div>

      {/* Footer */}
      <div style={{
        background: '#21203A',
        padding: '10px 16px',
        borderTop: '1px solid #272645',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <span style={{ color: '#8E93B8', fontSize: '11px' }}>
          This document is for internal training purposes only. Downloading and distribution is prohibited.
        </span>
      </div>
    </div>
  );
};

export default PDFViewer;
