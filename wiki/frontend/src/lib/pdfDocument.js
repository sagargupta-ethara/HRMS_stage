import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.js`;

const backendBaseUrl = process.env.REACT_APP_BACKEND_URL || '';

export const getSecurePdfDocument = (docId, token) =>
  pdfjsLib.getDocument({
    url: `${backendBaseUrl}/api/documents/${docId}`,
    httpHeaders: token ? { Authorization: `Bearer ${token}` } : {},
    withCredentials: false,
  });
