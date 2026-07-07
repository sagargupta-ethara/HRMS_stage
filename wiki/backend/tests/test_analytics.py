"""
Analytics Dashboard API Tests
Tests all analytics endpoints and activity tracking functionality
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")

class TestAnalyticsAPIs:
    """Test all analytics API endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Login and get auth token"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@ethara.ai", "password": ADMIN_PASSWORD}
        )
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
    
    # --- /api/analytics/overview ---
    def test_overview_returns_200(self):
        """Test overview endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers)
        assert response.status_code == 200
    
    def test_overview_structure(self):
        """Test overview response has correct structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers)
        data = response.json()
        
        # Check all required keys exist
        assert "page_views" in data
        assert "logins" in data
        assert "searches" in data
        assert "users" in data
        
        # Check page_views structure
        assert "total" in data["page_views"]
        assert "today" in data["page_views"]
        assert "week" in data["page_views"]
        
        # Check logins structure
        assert "total" in data["logins"]
        assert "today" in data["logins"]
        
        # Check users structure
        assert "total" in data["users"]
        assert "active_today" in data["users"]
    
    def test_overview_values_are_integers(self):
        """Test overview values are integers"""
        response = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers)
        data = response.json()
        
        assert isinstance(data["page_views"]["total"], int)
        assert isinstance(data["logins"]["total"], int)
        assert isinstance(data["users"]["total"], int)
    
    # --- /api/analytics/page-views ---
    def test_page_views_returns_200(self):
        """Test page-views endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/page-views", headers=self.headers)
        assert response.status_code == 200
    
    def test_page_views_structure(self):
        """Test page-views response has correct structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/page-views", headers=self.headers)
        data = response.json()
        
        assert "pages" in data
        assert isinstance(data["pages"], list)
        
        if len(data["pages"]) > 0:
            page = data["pages"][0]
            assert "slug" in page
            assert "title" in page
            assert "views" in page
            assert "last_viewed" in page
    
    # --- /api/analytics/user-activity ---
    def test_user_activity_returns_200(self):
        """Test user-activity endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-activity", headers=self.headers)
        assert response.status_code == 200
    
    def test_user_activity_structure(self):
        """Test user-activity response has correct structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-activity", headers=self.headers)
        data = response.json()
        
        assert "users" in data
        assert isinstance(data["users"], list)
        
        if len(data["users"]) > 0:
            user = data["users"][0]
            assert "email" in user
            assert "name" in user
            assert "role" in user
            assert "page_views" in user
            assert "searches" in user
            assert "logins" in user
            assert "last_active" in user
    
    # --- /api/analytics/hourly ---
    def test_hourly_returns_200(self):
        """Test hourly endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/hourly", headers=self.headers)
        assert response.status_code == 200
    
    def test_hourly_has_24_hours(self):
        """Test hourly response has 24 hours"""
        response = requests.get(f"{BASE_URL}/api/analytics/hourly", headers=self.headers)
        data = response.json()
        
        assert "hours" in data
        assert len(data["hours"]) == 24
    
    def test_hourly_structure(self):
        """Test hourly response has correct structure for each hour"""
        response = requests.get(f"{BASE_URL}/api/analytics/hourly", headers=self.headers)
        data = response.json()
        
        for hour_data in data["hours"]:
            assert "hour" in hour_data
            assert "page_view" in hour_data
            assert "login" in hour_data
            assert "search" in hour_data
            assert 0 <= hour_data["hour"] <= 23
    
    # --- /api/analytics/search-queries ---
    def test_search_queries_returns_200(self):
        """Test search-queries endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/search-queries", headers=self.headers)
        assert response.status_code == 200
    
    def test_search_queries_structure(self):
        """Test search-queries response has correct structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/search-queries", headers=self.headers)
        data = response.json()
        
        assert "queries" in data
        assert isinstance(data["queries"], list)
        
        if len(data["queries"]) > 0:
            query = data["queries"][0]
            assert "query" in query
            assert "count" in query
            assert "last_searched" in query
    
    # --- /api/analytics/recent ---
    def test_recent_returns_200(self):
        """Test recent endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/recent", headers=self.headers)
        assert response.status_code == 200
    
    def test_recent_structure(self):
        """Test recent response has correct structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/recent", headers=self.headers)
        data = response.json()
        
        assert "events" in data
        assert isinstance(data["events"], list)
        
        if len(data["events"]) > 0:
            event = data["events"][0]
            assert "event_type" in event
            assert "user_email" in event
            assert "timestamp" in event
            assert "user_name" in event
            assert "metadata" in event
    
    def test_recent_event_types(self):
        """Test recent events have valid event types"""
        response = requests.get(f"{BASE_URL}/api/analytics/recent", headers=self.headers)
        data = response.json()
        
        valid_types = ["page_view", "login", "search", "page_duration"]
        for event in data["events"]:
            assert event["event_type"] in valid_types
    
    # --- Authentication Tests ---
    def test_overview_requires_auth(self):
        """Test overview endpoint requires authentication"""
        response = requests.get(f"{BASE_URL}/api/analytics/overview")
        assert response.status_code in [401, 403]
    
    def test_page_views_requires_auth(self):
        """Test page-views endpoint requires authentication"""
        response = requests.get(f"{BASE_URL}/api/analytics/page-views")
        assert response.status_code in [401, 403]
    
    def test_user_activity_requires_auth(self):
        """Test user-activity endpoint requires authentication"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-activity")
        assert response.status_code in [401, 403]


class TestActivityTracking:
    """Test activity tracking functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Login and get auth token"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@ethara.ai", "password": ADMIN_PASSWORD}
        )
        assert login_response.status_code == 200
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
    
    def test_login_logs_activity(self):
        """Test that login creates a login event"""
        # Get current login count
        overview_before = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers).json()
        logins_before = overview_before["logins"]["total"]
        
        # Login again
        requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "admin@ethara.ai", "password": ADMIN_PASSWORD}
        )
        
        # Check login count increased
        overview_after = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers).json()
        logins_after = overview_after["logins"]["total"]
        
        assert logins_after >= logins_before
    
    def test_page_view_logs_activity(self):
        """Test that viewing a wiki page creates a page_view event"""
        # Get current page view count
        overview_before = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers).json()
        views_before = overview_before["page_views"]["total"]
        
        # View a wiki page
        requests.get(f"{BASE_URL}/api/wiki/pages/core-values", headers=self.headers)
        
        # Check page view count increased
        overview_after = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers).json()
        views_after = overview_after["page_views"]["total"]
        
        assert views_after > views_before
    
    def test_search_logs_activity(self):
        """Test that search creates a search event"""
        # Get current search count
        overview_before = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers).json()
        searches_before = overview_before["searches"]["total"]
        
        # Perform a search
        requests.get(f"{BASE_URL}/api/search?q=test_analytics_query", headers=self.headers)
        
        # Check search count increased
        overview_after = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.headers).json()
        searches_after = overview_after["searches"]["total"]
        
        assert searches_after > searches_before


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
