"""
Test suite for password reset hardening and profile features
- POST /api/auth/forgot-password (disabled by default)
- POST /api/auth/reset-password (disabled by default)
- PUT /api/auth/profile (update profile fields)
- POST /api/auth/profile/picture (upload profile picture)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "admin@ethara.ai"
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
ADMIN_DOB = "1990-05-15"

HR_EMAIL = "hr@ethara.ai"
HR_PASSWORD = os.environ.get("TEST_HR_PASSWORD") or os.environ.get("HR_BOOTSTRAP_PASSWORD", "Ethara@2026#Secure")
# HR user does NOT have DOB set

@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture(scope="module")
def admin_token(api_client):
    """Get admin authentication token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Admin authentication failed - skipping authenticated tests")

@pytest.fixture(scope="module")
def hr_token(api_client):
    """Get HR authentication token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": HR_EMAIL,
        "password": HR_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("HR authentication failed - skipping HR tests")


class TestPasswordResetHardening:
    """Self-service password reset stays disabled until HRMS integration is added"""

    def test_forgot_password_disabled_by_default(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": ADMIN_EMAIL,
            "dob": ADMIN_DOB
        })
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        data = response.json()
        assert "disabled" in data.get("detail", "").lower()
        print("PASS: Forgot-password endpoint is disabled by default")

    def test_reset_password_disabled_by_default(self, api_client):
        response = api_client.post(f"{BASE_URL}/api/auth/reset-password", json={
            "email": ADMIN_EMAIL,
            "dob": ADMIN_DOB,
            "new_password": "NewSecure@2026#Test"
        })
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        data = response.json()
        assert "disabled" in data.get("detail", "").lower()
        print("PASS: Reset-password endpoint is disabled by default")


class TestProfileUpdate:
    """Tests for PUT /api/auth/profile endpoint"""
    
    def test_update_profile_dob(self, api_client, admin_token):
        """Test: Update DOB field"""
        response = api_client.put(
            f"{BASE_URL}/api/auth/profile",
            json={"dob": "1990-05-15"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "user" in data
        assert data["user"].get("dob") == "1990-05-15"
        print(f"PASS: DOB updated successfully")
    
    def test_update_profile_company_doj(self, api_client, admin_token):
        """Test: Update company_doj field"""
        response = api_client.put(
            f"{BASE_URL}/api/auth/profile",
            json={"company_doj": "2024-01-15"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["user"].get("company_doj") == "2024-01-15"
        print(f"PASS: Company DOJ updated successfully")
    
    def test_update_profile_company_id(self, api_client, admin_token):
        """Test: Update company_id field"""
        response = api_client.put(
            f"{BASE_URL}/api/auth/profile",
            json={"company_id": "ETH-2024-001"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["user"].get("company_id") == "ETH-2024-001"
        print(f"PASS: Company ID updated successfully")
    
    def test_update_profile_multiple_fields(self, api_client, admin_token):
        """Test: Update multiple fields at once"""
        response = api_client.put(
            f"{BASE_URL}/api/auth/profile",
            json={
                "dob": "1990-05-15",
                "company_doj": "2024-01-15",
                "company_id": "ETH-2024-001"
            },
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["user"].get("dob") == "1990-05-15"
        assert data["user"].get("company_doj") == "2024-01-15"
        assert data["user"].get("company_id") == "ETH-2024-001"
        print(f"PASS: Multiple fields updated successfully")
    
    def test_update_profile_no_fields(self, api_client, admin_token):
        """Test: Empty update returns 400"""
        response = api_client.put(
            f"{BASE_URL}/api/auth/profile",
            json={},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        print(f"PASS: Empty update returns 400")
    
    def test_update_profile_unauthorized(self, api_client):
        """Test: Update without token returns 401/403"""
        response = api_client.put(
            f"{BASE_URL}/api/auth/profile",
            json={"dob": "1990-01-01"}
        )
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: Unauthorized update returns {response.status_code}")


class TestProfilePicture:
    """Tests for POST /api/auth/profile/picture endpoint"""
    
    def test_upload_profile_picture(self, admin_token):
        """Test: Upload valid image returns picture_url"""
        # Create a simple test image (1x1 pixel PNG)
        import base64
        # Minimal valid PNG (1x1 transparent pixel)
        png_data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        
        files = {"file": ("test.png", png_data, "image/png")}
        response = requests.post(
            f"{BASE_URL}/api/auth/profile/picture",
            files=files,
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "picture_url" in data
        assert data["picture_url"].startswith("/api/auth/profile/picture/")
        print(f"PASS: Profile picture uploaded, URL: {data['picture_url']}")
    
    def test_upload_invalid_file_type(self, admin_token):
        """Test: Upload non-image file returns 400"""
        files = {"file": ("test.txt", b"This is not an image", "text/plain")}
        response = requests.post(
            f"{BASE_URL}/api/auth/profile/picture",
            files=files,
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 400, f"Expected 400, got {response.status_code}: {response.text}"
        print(f"PASS: Invalid file type returns 400")
    
    def test_upload_picture_unauthorized(self):
        """Test: Upload without token returns 401/403"""
        import base64
        png_data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        files = {"file": ("test.png", png_data, "image/png")}
        response = requests.post(
            f"{BASE_URL}/api/auth/profile/picture",
            files=files
        )
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"
        print(f"PASS: Unauthorized upload returns {response.status_code}")


class TestGetProfilePicture:
    """Tests for GET /api/auth/profile/picture/{filename} endpoint"""
    
    def test_get_profile_picture(self, admin_token):
        """Test: Get uploaded profile picture"""
        # First upload a picture
        import base64
        png_data = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        )
        files = {"file": ("test.png", png_data, "image/png")}
        upload_response = requests.post(
            f"{BASE_URL}/api/auth/profile/picture",
            files=files,
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        if upload_response.status_code == 200:
            picture_url = upload_response.json().get("picture_url")
            # Get the picture
            get_response = requests.get(f"{BASE_URL}{picture_url}")
            assert get_response.status_code == 200, f"Expected 200, got {get_response.status_code}"
            print(f"PASS: Profile picture retrieved successfully")
        else:
            pytest.skip("Upload failed, skipping get test")
    
    def test_get_nonexistent_picture(self):
        """Test: Get non-existent picture returns 404"""
        response = requests.get(f"{BASE_URL}/api/auth/profile/picture/nonexistent.png")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print(f"PASS: Non-existent picture returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
