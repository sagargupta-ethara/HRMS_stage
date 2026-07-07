"""
Iteration 11 Tests: Analytics Dashboard Digital Nexus Theme + Agentic RL PDF + response limits
Tests:
1. Analytics Dashboard API endpoints (admin access)
2. Non-admin access denial for analytics
3. Agentic RL document endpoint
4. Search for Agentic RL document
5. Result limiting verification (wiki pages, search)
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_CREDS = {
    "email": "admin@ethara.ai",
    "password": os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123"),
}
HR_CREDS = {
    "email": "hr@ethara.ai",
    "password": os.environ.get("TEST_HR_PASSWORD") or os.environ.get("HR_BOOTSTRAP_PASSWORD", "Ethara@2026#Secure"),
}


class TestAuthentication:
    """Test login and token retrieval"""
    
    def test_admin_login(self):
        """Admin user can login successfully"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "admin"
        print(f"✓ Admin login successful, role: {data['user']['role']}")
    
    def test_hr_login(self):
        """HR user can login successfully"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=HR_CREDS)
        assert response.status_code == 200, f"HR login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "hr"
        print(f"✓ HR login successful, role: {data['user']['role']}")


@pytest.fixture
def admin_token():
    """Get admin authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("Admin authentication failed")


@pytest.fixture
def hr_token():
    """Get HR authentication token"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json=HR_CREDS)
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("HR authentication failed")


class TestAnalyticsDashboardAdmin:
    """Test Analytics Dashboard endpoints with admin access"""
    
    def test_analytics_overview(self, admin_token):
        """Admin can access analytics overview"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/overview", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "page_views" in data
        assert "logins" in data
        assert "searches" in data
        assert "users" in data
        print(f"✓ Analytics overview: page_views={data['page_views']['total']}, logins={data['logins']['total']}")
    
    def test_analytics_page_views(self, admin_token):
        """Admin can access page views analytics"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/page-views", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "pages" in data
        print(f"✓ Page views analytics: {len(data['pages'])} pages tracked")
    
    def test_analytics_user_activity(self, admin_token):
        """Admin can access user activity analytics"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/user-activity", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "users" in data
        print(f"✓ User activity analytics: {len(data['users'])} users tracked")
    
    def test_analytics_hourly(self, admin_token):
        """Admin can access hourly analytics"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/hourly", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "hours" in data
        assert len(data["hours"]) == 24
        print(f"✓ Hourly analytics: 24 hours data present")
    
    def test_analytics_search_queries(self, admin_token):
        """Admin can access search queries analytics"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/search-queries", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "queries" in data
        print(f"✓ Search queries analytics: {len(data['queries'])} queries tracked")
    
    def test_analytics_recent(self, admin_token):
        """Admin can access recent activity feed"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/recent", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "events" in data
        print(f"✓ Recent activity: {len(data['events'])} events")


class TestAnalyticsNonAdminAccess:
    """Test that non-admin users cannot access analytics"""
    
    def test_hr_cannot_access_overview(self, hr_token):
        """HR user gets 403 on analytics overview"""
        headers = {"Authorization": f"Bearer {hr_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/overview", headers=headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ HR user correctly denied access to analytics overview (403)")
    
    def test_hr_cannot_access_page_views(self, hr_token):
        """HR user gets 403 on page views analytics"""
        headers = {"Authorization": f"Bearer {hr_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/page-views", headers=headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ HR user correctly denied access to page views analytics (403)")
    
    def test_hr_cannot_access_user_activity(self, hr_token):
        """HR user gets 403 on user activity analytics"""
        headers = {"Authorization": f"Bearer {hr_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/user-activity", headers=headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ HR user correctly denied access to user activity analytics (403)")
    
    def test_hr_cannot_access_hourly(self, hr_token):
        """HR user gets 403 on hourly analytics"""
        headers = {"Authorization": f"Bearer {hr_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/hourly", headers=headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ HR user correctly denied access to hourly analytics (403)")
    
    def test_hr_cannot_access_recent(self, hr_token):
        """HR user gets 403 on recent activity"""
        headers = {"Authorization": f"Bearer {hr_token}"}
        response = requests.get(f"{BASE_URL}/api/analytics/recent", headers=headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ HR user correctly denied access to recent activity (403)")


class TestAgenticRLDocument:
    """Test Agentic RL document endpoint and search"""
    
    def test_agentic_rl_document_endpoint(self, admin_token):
        """Agentic RL document endpoint returns 200"""
        # The endpoint streams PDF, so we just check it starts successfully
        response = requests.get(
            f"{BASE_URL}/api/documents/agentic-rl",
            headers={"Authorization": f"Bearer {admin_token}"},
            stream=True,
            timeout=30
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert response.headers.get("content-type") == "application/pdf"
        print("✓ Agentic RL document endpoint returns 200 with PDF content-type")
    
    def test_agentic_rl_searchable(self, admin_token):
        """Agentic RL document is searchable from search endpoint"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/search", params={"q": "agentic"}, headers=headers)
        assert response.status_code == 200, f"Search failed: {response.text}"
        data = response.json()
        results = data.get("results", [])
        
        # Check if Agentic RL appears in search results
        agentic_found = any("agentic" in r.get("title", "").lower() for r in results)
        assert agentic_found, f"Agentic RL not found in search results: {results}"
        print(f"✓ Agentic RL found in search results ({len(results)} total results)")
    
    def test_agentic_rl_search_route(self, admin_token):
        """Agentic RL search result has correct route"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/search", params={"q": "agentic rl"}, headers=headers)
        assert response.status_code == 200
        data = response.json()
        results = data.get("results", [])
        
        agentic_result = next((r for r in results if "agentic" in r.get("title", "").lower()), None)
        assert agentic_result is not None, "Agentic RL not found in search"
        assert agentic_result.get("route") == "/training/deep-learning/agentic-rl", \
            f"Wrong route: {agentic_result.get('route')}"
        print(f"✓ Agentic RL search result has correct route: {agentic_result.get('route')}")


class TestResponseLimits:
    """Test that list endpoints apply the expected limits"""
    
    def test_wiki_pages_endpoint(self, admin_token):
        """Wiki pages endpoint returns limited results"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/wiki/pages", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        pages = data.get("pages", [])
        # Should be limited to 100 max
        assert len(pages) <= 100, f"Wiki pages not limited: {len(pages)} pages returned"
        print(f"✓ Wiki pages endpoint returns {len(pages)} pages (limit 100)")
    
    def test_search_endpoint_returns_limited(self, admin_token):
        """Search endpoint returns limited results"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        # Search for a common term
        response = requests.get(f"{BASE_URL}/api/search", params={"q": "a"}, headers=headers)
        assert response.status_code == 200, f"Search failed: {response.text}"
        data = response.json()
        results = data.get("results", [])
        # Should be limited to 20 max
        assert len(results) <= 20, f"Search results not limited: {len(results)} results"
        print(f"✓ Search endpoint returns {len(results)} results (limit 20)")


class TestDashboardEndpoints:
    """Test main dashboard endpoints"""
    
    def test_dashboard_categories(self, admin_token):
        """Dashboard categories endpoint works"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/wiki/categories", headers=headers)
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        categories = data.get("categories", [])
        assert len(categories) > 0, "No categories returned"
        
        # Check Training & Learning category exists
        training_cat = next((c for c in categories if c["id"] == "training"), None)
        assert training_cat is not None, "Training category not found"
        assert "Deep Learning" in training_cat.get("subcategories", [])
        print(f"✓ Categories endpoint: {len(categories)} categories, Training has Deep Learning subcategory")
    
    def test_health_endpoint(self):
        """Health endpoint returns ok"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        assert response.json().get("status") == "ok"
        print("✓ Health endpoint returns ok")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
