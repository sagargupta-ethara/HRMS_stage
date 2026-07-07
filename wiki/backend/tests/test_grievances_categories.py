"""
Test cases for Grievance Portal and Category Updates
Features tested:
- Wiki categories updated (removed Strategy & Leadership, Knowledge Systems)
- Wiki categories updated (Training & Learning with subcategories)
- Grievance submission (named and anonymous)
- Grievance management (HR only)
- Role-based access control for grievances
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials (from env, with safe defaults for local CI)
TEST_USER_EMAIL = os.environ.get('TEST_USER_EMAIL', 'testuser@example.com')
TEST_USER_PASSWORD = os.environ.get('TEST_USER_PASSWORD') or os.environ.get('TEST_USER_BOOTSTRAP_PASSWORD', 'test123')


class TestAuthSetup:
    """Authentication setup for all tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token for test user (viewer role)"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_USER_EMAIL,
            "password": TEST_USER_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        return response.json()["token"]
    
    @pytest.fixture(scope="class")
    def auth_headers(self, auth_token):
        """Get headers with authentication"""
        return {
            "Authorization": f"Bearer {auth_token}",
            "Content-Type": "application/json"
        }
    
    @pytest.fixture(scope="class")
    def user_info(self, auth_token):
        """Get current user info"""
        response = requests.get(f"{BASE_URL}/api/auth/me", 
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        return response.json()["user"]


class TestWikiCategories(TestAuthSetup):
    """Test wiki categories have been updated correctly"""
    
    def test_categories_endpoint_returns_200(self, auth_headers):
        """Test categories endpoint is accessible"""
        response = requests.get(f"{BASE_URL}/api/wiki/categories",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Categories endpoint failed: {response.text}"
        data = response.json()
        assert "categories" in data
        print(f"✓ Categories endpoint returns 200 with {len(data['categories'])} categories")
    
    def test_strategy_leadership_category_removed(self, auth_headers):
        """Test Strategy & Leadership category has been removed"""
        response = requests.get(f"{BASE_URL}/api/wiki/categories",
            headers=auth_headers
        )
        data = response.json()
        category_ids = [cat["id"] for cat in data["categories"]]
        category_names = [cat["name"] for cat in data["categories"]]
        
        assert "strategy" not in category_ids, "Strategy category should be removed"
        assert "Strategy & Leadership" not in category_names, "Strategy & Leadership should be removed"
        print("✓ Strategy & Leadership category successfully removed")
    
    def test_knowledge_systems_category_removed(self, auth_headers):
        """Test Knowledge Systems category has been removed"""
        response = requests.get(f"{BASE_URL}/api/wiki/categories",
            headers=auth_headers
        )
        data = response.json()
        category_ids = [cat["id"] for cat in data["categories"]]
        category_names = [cat["name"] for cat in data["categories"]]
        
        assert "knowledge" not in category_ids, "Knowledge category should be removed"
        assert "Knowledge Systems" not in category_names, "Knowledge Systems should be removed"
        print("✓ Knowledge Systems category successfully removed")
    
    def test_training_learning_category_exists(self, auth_headers):
        """Test Training & Learning category exists"""
        response = requests.get(f"{BASE_URL}/api/wiki/categories",
            headers=auth_headers
        )
        data = response.json()
        
        training_category = None
        for cat in data["categories"]:
            if cat["id"] == "training" or cat["name"] == "Training & Learning":
                training_category = cat
                break
        
        assert training_category is not None, "Training & Learning category should exist"
        print(f"✓ Training & Learning category found: {training_category}")
    
    def test_training_learning_subcategories(self, auth_headers):
        """Test Training & Learning has correct subcategories"""
        response = requests.get(f"{BASE_URL}/api/wiki/categories",
            headers=auth_headers
        )
        data = response.json()
        
        training_category = None
        for cat in data["categories"]:
            if cat["id"] == "training":
                training_category = cat
                break
        
        assert training_category is not None, "Training category not found"
        subcats = training_category.get("subcategories", [])
        
        assert "Deep Learning" in subcats, "Deep Learning subcategory missing"
        assert "Training: Get Started" in subcats, "Training: Get Started subcategory missing"
        print(f"✓ Training & Learning subcategories: {subcats}")


class TestGrievanceCategories(TestAuthSetup):
    """Test grievance categories endpoint"""
    
    def test_get_grievance_categories(self, auth_headers):
        """Test getting list of grievance categories"""
        response = requests.get(f"{BASE_URL}/api/grievances/categories",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Get categories failed: {response.text}"
        data = response.json()
        
        assert "categories" in data
        assert isinstance(data["categories"], list)
        assert len(data["categories"]) > 0
        
        expected_categories = [
            "Workplace Harassment",
            "Discrimination",
            "Compensation & Benefits",
            "Work Environment",
            "Management Issues",
            "Policy Violations",
            "Safety Concerns",
            "Other"
        ]
        
        for cat in expected_categories:
            assert cat in data["categories"], f"Missing category: {cat}"
        
        print(f"✓ Grievance categories: {data['categories']}")


class TestGrievanceSubmission(TestAuthSetup):
    """Test grievance submission functionality"""
    
    created_grievance_ids = []
    
    def test_submit_grievance_with_name(self, auth_headers, user_info):
        """Test submitting a grievance with name (non-anonymous)"""
        response = requests.post(f"{BASE_URL}/api/grievances",
            headers=auth_headers,
            json={
                "category": "Work Environment",
                "description": "TEST_NAMED: This is a test grievance submitted with name",
                "is_anonymous": False
            }
        )
        assert response.status_code == 200, f"Submit grievance failed: {response.text}"
        data = response.json()
        
        assert "grievance" in data
        grievance = data["grievance"]
        
        assert grievance["category"] == "Work Environment"
        assert grievance["description"] == "TEST_NAMED: This is a test grievance submitted with name"
        assert grievance["is_anonymous"] == False
        assert grievance["submitted_by"] == user_info["email"]
        assert grievance["submitted_by_name"] == user_info["name"]
        assert grievance["status"] == "pending"
        
        TestGrievanceSubmission.created_grievance_ids.append(grievance["id"])
        print(f"✓ Named grievance submitted successfully: id={grievance['id']}")
    
    def test_submit_grievance_anonymous(self, auth_headers):
        """Test submitting an anonymous grievance"""
        response = requests.post(f"{BASE_URL}/api/grievances",
            headers=auth_headers,
            json={
                "category": "Management Issues",
                "description": "TEST_ANON: This is an anonymous test grievance",
                "is_anonymous": True
            }
        )
        assert response.status_code == 200, f"Submit anonymous grievance failed: {response.text}"
        data = response.json()
        
        grievance = data["grievance"]
        
        assert grievance["is_anonymous"] == True
        assert grievance["submitted_by"] is None, "Anonymous grievance should not have submitted_by"
        assert grievance["submitted_by_name"] is None, "Anonymous grievance should not have submitted_by_name"
        
        TestGrievanceSubmission.created_grievance_ids.append(grievance["id"])
        print(f"✓ Anonymous grievance submitted successfully: id={grievance['id']}")
    
    def test_submit_grievance_invalid_category(self, auth_headers):
        """Test submitting grievance with invalid category"""
        response = requests.post(f"{BASE_URL}/api/grievances",
            headers=auth_headers,
            json={
                "category": "Invalid Category",
                "description": "This should fail",
                "is_anonymous": False
            }
        )
        assert response.status_code == 400, f"Expected 400 for invalid category: {response.status_code}"
        print("✓ Invalid category correctly rejected with 400")


class TestMyGrievances(TestAuthSetup):
    """Test my grievances endpoint"""
    
    def test_get_my_grievances(self, auth_headers):
        """Test getting user's own grievances (non-anonymous only)"""
        response = requests.get(f"{BASE_URL}/api/grievances/my",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Get my grievances failed: {response.text}"
        data = response.json()
        
        assert "grievances" in data
        assert isinstance(data["grievances"], list)
        
        # All grievances should have submitted_by (non-anonymous)
        for g in data["grievances"]:
            assert g["is_anonymous"] == False, "Anonymous grievances should not appear in my grievances"
        
        print(f"✓ My grievances retrieved: count={len(data['grievances'])}")


class TestGrievanceAccessControl(TestAuthSetup):
    """Test role-based access control for grievance management"""
    
    def test_viewer_cannot_access_all_grievances(self, auth_headers, user_info):
        """Test that viewer role cannot access all grievances endpoint"""
        # Skip if user is admin or hr
        if user_info["role"] in ["admin", "hr"]:
            pytest.skip("User is admin/hr, skipping viewer access test")
        
        response = requests.get(f"{BASE_URL}/api/grievances",
            headers=auth_headers
        )
        assert response.status_code == 403, f"Expected 403 for viewer: {response.status_code}"
        print(f"✓ Viewer (role={user_info['role']}) correctly denied access to all grievances")
    
    def test_viewer_cannot_update_grievance(self, auth_headers, user_info):
        """Test that viewer cannot update grievance status"""
        if user_info["role"] in ["admin", "hr"]:
            pytest.skip("User is admin/hr, skipping viewer access test")
        
        # Try to update a random grievance ID
        response = requests.put(f"{BASE_URL}/api/grievances/000000000000000000000000",
            headers=auth_headers,
            json={
                "status": "in_review",
                "hr_notes": "Test notes"
            }
        )
        assert response.status_code == 403, f"Expected 403 for viewer update: {response.status_code}"
        print("✓ Viewer correctly denied permission to update grievance")
    
    def test_viewer_cannot_delete_grievance(self, auth_headers, user_info):
        """Test that viewer cannot delete grievance"""
        if user_info["role"] in ["admin", "hr"]:
            pytest.skip("User is admin/hr, skipping viewer access test")
        
        response = requests.delete(f"{BASE_URL}/api/grievances/000000000000000000000000",
            headers=auth_headers
        )
        assert response.status_code == 403, f"Expected 403 for viewer delete: {response.status_code}"
        print("✓ Viewer correctly denied permission to delete grievance")


class TestWikiEditPermissions(TestAuthSetup):
    """Test wiki edit permissions"""
    
    def test_viewer_cannot_create_wiki_page(self, auth_headers, user_info):
        """Test that viewer cannot create wiki pages"""
        if user_info["role"] == "admin":
            pytest.skip("User is admin, skipping viewer permission test")
        
        response = requests.post(f"{BASE_URL}/api/wiki/pages",
            headers=auth_headers,
            json={
                "title": "TEST: Unauthorized Page",
                "category": "foundation",
                "subcategory": "Core Values",
                "content_html": "<p>Test content</p>",
                "content_text": "Test content"
            }
        )
        assert response.status_code == 403, f"Expected 403 for viewer create: {response.status_code}"
        print(f"✓ Viewer (role={user_info['role']}) correctly denied permission to create wiki page")
    
    def test_viewer_cannot_update_wiki_page(self, auth_headers, user_info):
        """Test that viewer cannot update wiki pages"""
        if user_info["role"] == "admin":
            pytest.skip("User is admin, skipping viewer permission test")
        
        response = requests.put(f"{BASE_URL}/api/wiki/pages/core-values",
            headers=auth_headers,
            json={
                "title": "Updated Title",
                "content_html": "<p>Updated content</p>",
                "content_text": "Updated content"
            }
        )
        assert response.status_code == 403, f"Expected 403 for viewer update: {response.status_code}"
        print("✓ Viewer correctly denied permission to update wiki page")
    
    def test_viewer_cannot_delete_wiki_page(self, auth_headers, user_info):
        """Test that viewer cannot delete wiki pages"""
        if user_info["role"] == "admin":
            pytest.skip("User is admin, skipping viewer permission test")
        
        response = requests.delete(f"{BASE_URL}/api/wiki/pages/core-values",
            headers=auth_headers
        )
        assert response.status_code == 403, f"Expected 403 for viewer delete: {response.status_code}"
        print("✓ Viewer correctly denied permission to delete wiki page")


class TestCleanup(TestAuthSetup):
    """Cleanup test data"""
    
    def test_cleanup_test_grievances(self, auth_headers, user_info):
        """Clean up TEST_ prefixed grievances from my grievances"""
        response = requests.get(f"{BASE_URL}/api/grievances/my",
            headers=auth_headers
        )
        grievances = response.json().get("grievances", [])
        
        deleted_count = 0
        for g in grievances:
            if g["description"].startswith("TEST_"):
                # Only admin can delete, so just log
                print(f"  Note: Test grievance id={g['id']} needs admin cleanup")
        
        print(f"✓ Cleanup noted - {len(TestGrievanceSubmission.created_grievance_ids)} test grievances created")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
