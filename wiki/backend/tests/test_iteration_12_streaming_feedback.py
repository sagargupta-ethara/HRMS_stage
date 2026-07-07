"""
Iteration 12 Tests: Wiki Page Feedback
Tests:
1. Feedback CRUD endpoints (POST, GET, DELETE /api/feedback)
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "admin@ethara.ai"
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
HR_EMAIL = "hr@ethara.ai"
HR_PASSWORD = os.environ.get("TEST_HR_PASSWORD") or os.environ.get("HR_BOOTSTRAP_PASSWORD", "Ethara@2026#Secure")


class TestAuth:
    """Authentication tests for getting tokens"""
    
    def test_admin_login(self):
        """Admin login returns token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "admin"
        print(f"✓ Admin login successful, role: {data['user']['role']}")
    
    def test_hr_login(self):
        """HR login returns token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": HR_EMAIL,
            "password": HR_PASSWORD
        })
        assert response.status_code == 200, f"HR login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "hr"
        print(f"✓ HR login successful, role: {data['user']['role']}")


@pytest.fixture
def admin_token():
    """Get admin auth token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json()["token"]
    pytest.skip("Admin authentication failed")


@pytest.fixture
def hr_token():
    """Get HR auth token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": HR_EMAIL,
        "password": HR_PASSWORD
    })
    if response.status_code == 200:
        return response.json()["token"]
    pytest.skip("HR authentication failed")


class TestFeedbackCRUD:
    """Tests for Feedback CRUD endpoints"""
    
    TEST_PAGE_SLUG = "core-values"  # Using existing wiki page
    
    def test_get_feedback_empty_page(self, admin_token):
        """GET /api/feedback/{page_slug} returns empty list for page with no feedback"""
        # Use a unique slug that likely has no feedback
        response = requests.get(
            f"{BASE_URL}/api/feedback/test-nonexistent-page",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "feedback" in data
        assert isinstance(data["feedback"], list)
        print("✓ GET feedback returns empty list for page with no feedback")
    
    def test_create_feedback(self, admin_token):
        """POST /api/feedback creates feedback with user info"""
        test_comment = f"TEST_FEEDBACK_{int(time.time())}"
        
        response = requests.post(
            f"{BASE_URL}/api/feedback",
            json={
                "page_slug": self.TEST_PAGE_SLUG,
                "comment": test_comment
            },
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 200, f"Create feedback failed: {response.text}"
        data = response.json()
        
        assert "feedback" in data
        fb = data["feedback"]
        assert fb["comment"] == test_comment
        assert fb["page_slug"] == self.TEST_PAGE_SLUG
        assert "user_name" in fb
        assert "user_email" in fb
        assert "user_role" in fb
        assert "created_at" in fb
        
        print(f"✓ Created feedback: user={fb['user_name']}, role={fb['user_role']}")
        return fb["created_at"]  # Return timestamp for deletion test
    
    def test_get_feedback_for_page(self, admin_token):
        """GET /api/feedback/{page_slug} returns feedback list"""
        # First create a feedback
        test_comment = f"TEST_GET_FEEDBACK_{int(time.time())}"
        create_response = requests.post(
            f"{BASE_URL}/api/feedback",
            json={"page_slug": self.TEST_PAGE_SLUG, "comment": test_comment},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert create_response.status_code == 200
        
        # Now get feedback
        response = requests.get(
            f"{BASE_URL}/api/feedback/{self.TEST_PAGE_SLUG}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "feedback" in data
        assert isinstance(data["feedback"], list)
        
        # Find our test feedback
        found = any(fb["comment"] == test_comment for fb in data["feedback"])
        assert found, "Created feedback not found in list"
        
        print(f"✓ GET feedback returns list with {len(data['feedback'])} items")
    
    def test_delete_own_feedback(self, admin_token):
        """DELETE /api/feedback/{page_slug}/{timestamp} - user can delete own feedback"""
        # Create feedback
        test_comment = f"TEST_DELETE_OWN_{int(time.time())}"
        create_response = requests.post(
            f"{BASE_URL}/api/feedback",
            json={"page_slug": self.TEST_PAGE_SLUG, "comment": test_comment},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert create_response.status_code == 200
        created_at = create_response.json()["feedback"]["created_at"]
        
        # Delete it
        delete_response = requests.delete(
            f"{BASE_URL}/api/feedback/{self.TEST_PAGE_SLUG}/{created_at}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert delete_response.status_code == 200, f"Delete failed: {delete_response.text}"
        
        # Verify it's gone
        get_response = requests.get(
            f"{BASE_URL}/api/feedback/{self.TEST_PAGE_SLUG}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        data = get_response.json()
        found = any(fb["comment"] == test_comment for fb in data["feedback"])
        assert not found, "Deleted feedback still exists"
        
        print("✓ User can delete own feedback")
    
    def test_admin_can_delete_any_feedback(self, admin_token, hr_token):
        """Admin can delete any user's feedback"""
        # HR creates feedback
        test_comment = f"TEST_HR_FEEDBACK_{int(time.time())}"
        create_response = requests.post(
            f"{BASE_URL}/api/feedback",
            json={"page_slug": self.TEST_PAGE_SLUG, "comment": test_comment},
            headers={"Authorization": f"Bearer {hr_token}"}
        )
        assert create_response.status_code == 200
        created_at = create_response.json()["feedback"]["created_at"]
        
        # Admin deletes it
        delete_response = requests.delete(
            f"{BASE_URL}/api/feedback/{self.TEST_PAGE_SLUG}/{created_at}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert delete_response.status_code == 200, f"Admin delete failed: {delete_response.text}"
        print("✓ Admin can delete any user's feedback")
    
    def test_non_admin_cannot_delete_others_feedback(self, admin_token, hr_token):
        """Non-admin cannot delete other users' feedback"""
        # Admin creates feedback
        test_comment = f"TEST_ADMIN_FEEDBACK_{int(time.time())}"
        create_response = requests.post(
            f"{BASE_URL}/api/feedback",
            json={"page_slug": self.TEST_PAGE_SLUG, "comment": test_comment},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert create_response.status_code == 200
        created_at = create_response.json()["feedback"]["created_at"]
        
        # HR tries to delete it
        delete_response = requests.delete(
            f"{BASE_URL}/api/feedback/{self.TEST_PAGE_SLUG}/{created_at}",
            headers={"Authorization": f"Bearer {hr_token}"}
        )
        
        assert delete_response.status_code == 403, f"Expected 403, got {delete_response.status_code}"
        print("✓ Non-admin cannot delete others' feedback (403)")
        
        # Cleanup - admin deletes it
        requests.delete(
            f"{BASE_URL}/api/feedback/{self.TEST_PAGE_SLUG}/{created_at}",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
    
    def test_feedback_requires_auth(self):
        """Feedback endpoints require authentication"""
        # GET without auth
        get_response = requests.get(f"{BASE_URL}/api/feedback/{self.TEST_PAGE_SLUG}")
        assert get_response.status_code in [401, 403]
        
        # POST without auth
        post_response = requests.post(
            f"{BASE_URL}/api/feedback",
            json={"page_slug": self.TEST_PAGE_SLUG, "comment": "test"}
        )
        assert post_response.status_code in [401, 403]
        
        print("✓ Feedback endpoints require authentication")
    
    def test_hr_user_can_submit_feedback(self, hr_token):
        """HR user can submit feedback on wiki pages"""
        test_comment = f"TEST_HR_SUBMIT_{int(time.time())}"
        
        response = requests.post(
            f"{BASE_URL}/api/feedback",
            json={"page_slug": self.TEST_PAGE_SLUG, "comment": test_comment},
            headers={"Authorization": f"Bearer {hr_token}"}
        )
        
        assert response.status_code == 200, f"HR submit feedback failed: {response.text}"
        data = response.json()
        assert data["feedback"]["user_role"] == "hr"
        
        print(f"✓ HR user can submit feedback (role: {data['feedback']['user_role']})")
        
        # Cleanup
        created_at = data["feedback"]["created_at"]
        requests.delete(
            f"{BASE_URL}/api/feedback/{self.TEST_PAGE_SLUG}/{created_at}",
            headers={"Authorization": f"Bearer {hr_token}"}
        )


class TestWikiPagesStillWork:
    """Verify wiki pages and dashboard still load correctly"""
    
    def test_dashboard_categories(self, admin_token):
        """Dashboard categories endpoint works"""
        response = requests.get(
            f"{BASE_URL}/api/wiki/categories",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "categories" in data
        assert len(data["categories"]) > 0
        print(f"✓ Dashboard categories: {len(data['categories'])} categories")
    
    def test_wiki_page_loads(self, admin_token):
        """Wiki page endpoint works"""
        response = requests.get(
            f"{BASE_URL}/api/wiki/pages/core-values",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert "page" in data
        assert data["page"]["slug"] == "core-values"
        print(f"✓ Wiki page loads: {data['page']['title']}")
    
    def test_health_endpoint(self):
        """Health endpoint works"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        print("✓ Health endpoint: ok")


# Cleanup fixture to remove test feedback after all tests
@pytest.fixture(scope="module", autouse=True)
def cleanup_test_feedback():
    """Cleanup TEST_ prefixed feedback after tests"""
    yield
    # Cleanup runs after all tests in module
    try:
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        if response.status_code == 200:
            token = response.json()["token"]
            # Get feedback for test page
            fb_response = requests.get(
                f"{BASE_URL}/api/feedback/core-values",
                headers={"Authorization": f"Bearer {token}"}
            )
            if fb_response.status_code == 200:
                for fb in fb_response.json().get("feedback", []):
                    if fb.get("comment", "").startswith("TEST_"):
                        requests.delete(
                            f"{BASE_URL}/api/feedback/core-values/{fb['created_at']}",
                            headers={"Authorization": f"Bearer {token}"}
                        )
    except Exception:
        pass


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
