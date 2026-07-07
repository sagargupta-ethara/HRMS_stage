# Test file for Process Flow PDF page and local auth hardening
# Features: PDF proxy endpoint, local public session, closed self-registration

import pytest
import requests
import os
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'http://127.0.0.1:8001').rstrip('/')


def _auth_headers(token):
    return {"Authorization": f"Bearer {token}"}

class TestHealthCheck:
    """Basic health check to ensure backend is running"""
    
    def test_health_endpoint(self):
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        print("✓ Health check passed")


class TestAuthHardening:
    """Local direct access stays available, but self-service account creation is off"""

    def test_self_service_registration_disabled(self):
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": "testuser@gmail.com",
            "password": "test123",
            "name": "Test User"
        })
        assert response.status_code == 403
        data = response.json()
        assert "disabled" in data["detail"].lower()
        print("✓ Self-service registration is disabled")

    def test_local_session_works_on_loopback(self):
        response = requests.post(f"{BASE_URL}/api/auth/local-session")
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["email"] == "local.viewer@wiki.local"
        print("✓ Local public session works on loopback")


class TestPDFDocumentProxy:
    """Tests for PDF document proxy endpoint"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get local viewer token for document tests"""
        response = requests.post(f"{BASE_URL}/api/auth/local-session")
        if response.status_code == 200:
            return response.json()["token"]
        pytest.skip("Could not authenticate - skipping PDF tests")
    
    def test_pdf_endpoint_without_token_returns_401(self):
        """PDF endpoint without token should return 401"""
        response = requests.get(f"{BASE_URL}/api/documents/process-flow")
        assert response.status_code == 401
        data = response.json()
        assert "bearer" in data["detail"].lower() or "unauthorized" in data["detail"].lower()
        print("✓ PDF endpoint without token returns 401")
    
    def test_pdf_endpoint_with_invalid_token_returns_401(self):
        """PDF endpoint with invalid token should return 401"""
        response = requests.get(
            f"{BASE_URL}/api/documents/process-flow",
            headers=_auth_headers("invalid_token_xyz"),
        )
        assert response.status_code == 401
        print("✓ PDF endpoint with invalid token returns 401")
    
    def test_pdf_endpoint_with_valid_token_returns_200(self, auth_token):
        """PDF endpoint with valid token should return 200 and PDF content"""
        response = requests.get(f"{BASE_URL}/api/documents/process-flow", headers=_auth_headers(auth_token))
        assert response.status_code == 200
        # Check content type is PDF
        content_type = response.headers.get("content-type", "")
        assert "application/pdf" in content_type
        print("✓ PDF endpoint with valid token returns 200 with PDF content")
    
    def test_pdf_endpoint_nonexistent_doc_returns_404(self, auth_token):
        """PDF endpoint for nonexistent document should return 404"""
        response = requests.get(
            f"{BASE_URL}/api/documents/nonexistent-document",
            headers=_auth_headers(auth_token),
        )
        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"].lower()
        print("✓ PDF endpoint for nonexistent doc returns 404")
    
    def test_pdf_headers_prevent_caching(self, auth_token):
        """PDF response should have cache-control headers to prevent caching"""
        response = requests.get(f"{BASE_URL}/api/documents/process-flow", headers=_auth_headers(auth_token))
        assert response.status_code == 200
        cache_control = response.headers.get("cache-control", "")
        assert "no-store" in cache_control or "no-cache" in cache_control
        print("✓ PDF headers prevent caching")
    
    def test_pdf_has_content_disposition_header(self, auth_token):
        """PDF response should have content-disposition header"""
        response = requests.get(f"{BASE_URL}/api/documents/process-flow", headers=_auth_headers(auth_token))
        assert response.status_code == 200
        content_disposition = response.headers.get("content-disposition", "")
        assert "process-flow" in content_disposition
        print("✓ PDF has content-disposition header")


class TestExistingAuthEndpoints:
    """Verify existing auth endpoints still work correctly"""
    
    def test_login_with_invalid_credentials(self):
        """Login with wrong password should return 401"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@ethara.ai",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("✓ Invalid credentials rejected")
    
    def test_login_with_nonexistent_user(self):
        """Login with nonexistent user should return 401"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "nonexistent@ethara.ai",
            "password": "test123"
        })
        assert response.status_code == 401
        print("✓ Nonexistent user rejected")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
