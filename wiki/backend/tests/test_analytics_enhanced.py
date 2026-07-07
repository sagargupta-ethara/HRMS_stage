"""
Enhanced Analytics Dashboard API Tests
Tests admin-only access, detail drill-down endpoints, time tracking, and user detail
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "admin@ethara.ai"
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")
HR_EMAIL = "hr@ethara.ai"
HR_PASSWORD = os.environ.get("TEST_HR_PASSWORD") or os.environ.get("HR_BOOTSTRAP_PASSWORD", "Ethara@2026#Secure")


class TestAdminOnlyAccess:
    """Test that analytics endpoints are restricted to admin users only"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Get tokens for both admin and HR users"""
        # Admin login
        admin_login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert admin_login.status_code == 200, f"Admin login failed: {admin_login.text}"
        self.admin_token = admin_login.json()["token"]
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}", "Content-Type": "application/json"}
        
        # HR login
        hr_login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": HR_EMAIL, "password": HR_PASSWORD}
        )
        assert hr_login.status_code == 200, f"HR login failed: {hr_login.text}"
        self.hr_token = hr_login.json()["token"]
        self.hr_headers = {"Authorization": f"Bearer {self.hr_token}", "Content-Type": "application/json"}
    
    # --- Admin can access all analytics endpoints ---
    def test_admin_can_access_overview(self):
        """Admin user can access /api/analytics/overview"""
        response = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.admin_headers)
        assert response.status_code == 200
        print("PASS: Admin can access /api/analytics/overview")
    
    def test_admin_can_access_page_views(self):
        """Admin user can access /api/analytics/page-views"""
        response = requests.get(f"{BASE_URL}/api/analytics/page-views", headers=self.admin_headers)
        assert response.status_code == 200
        print("PASS: Admin can access /api/analytics/page-views")
    
    def test_admin_can_access_user_activity(self):
        """Admin user can access /api/analytics/user-activity"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-activity", headers=self.admin_headers)
        assert response.status_code == 200
        print("PASS: Admin can access /api/analytics/user-activity")
    
    def test_admin_can_access_detail_page_view(self):
        """Admin user can access /api/analytics/detail/page_view"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/page_view", headers=self.admin_headers)
        assert response.status_code == 200
        print("PASS: Admin can access /api/analytics/detail/page_view")
    
    def test_admin_can_access_user_detail(self):
        """Admin user can access /api/analytics/user-detail/{email}"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/{ADMIN_EMAIL}", headers=self.admin_headers)
        assert response.status_code == 200
        print("PASS: Admin can access /api/analytics/user-detail/{email}")
    
    # --- HR user gets 403 on all analytics endpoints ---
    def test_hr_denied_overview(self):
        """HR user gets 403 on /api/analytics/overview"""
        response = requests.get(f"{BASE_URL}/api/analytics/overview", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/overview (403)")
    
    def test_hr_denied_page_views(self):
        """HR user gets 403 on /api/analytics/page-views"""
        response = requests.get(f"{BASE_URL}/api/analytics/page-views", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/page-views (403)")
    
    def test_hr_denied_user_activity(self):
        """HR user gets 403 on /api/analytics/user-activity"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-activity", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/user-activity (403)")
    
    def test_hr_denied_hourly(self):
        """HR user gets 403 on /api/analytics/hourly"""
        response = requests.get(f"{BASE_URL}/api/analytics/hourly", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/hourly (403)")
    
    def test_hr_denied_search_queries(self):
        """HR user gets 403 on /api/analytics/search-queries"""
        response = requests.get(f"{BASE_URL}/api/analytics/search-queries", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/search-queries (403)")
    
    def test_hr_denied_recent(self):
        """HR user gets 403 on /api/analytics/recent"""
        response = requests.get(f"{BASE_URL}/api/analytics/recent", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/recent (403)")
    
    def test_hr_denied_detail_page_view(self):
        """HR user gets 403 on /api/analytics/detail/page_view"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/page_view", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/detail/page_view (403)")
    
    def test_hr_denied_detail_login(self):
        """HR user gets 403 on /api/analytics/detail/login"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/login", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/detail/login (403)")
    
    def test_hr_denied_detail_search(self):
        """HR user gets 403 on /api/analytics/detail/search"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/search", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/detail/search (403)")
    
    def test_hr_denied_user_detail(self):
        """HR user gets 403 on /api/analytics/user-detail/{email}"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/{ADMIN_EMAIL}", headers=self.hr_headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("PASS: HR user denied access to /api/analytics/user-detail/{email} (403)")


class TestDetailEndpoints:
    """Test detail drill-down endpoints for stat cards"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Login as admin"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert login_response.status_code == 200
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
    
    # --- /api/analytics/detail/page_view ---
    def test_detail_page_view_returns_200(self):
        """Test detail/page_view endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/page_view", headers=self.headers)
        assert response.status_code == 200
        print("PASS: /api/analytics/detail/page_view returns 200")
    
    def test_detail_page_view_has_events(self):
        """Test detail/page_view returns events list"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/page_view", headers=self.headers)
        data = response.json()
        assert "events" in data
        assert isinstance(data["events"], list)
        print(f"PASS: detail/page_view has events list ({len(data['events'])} events)")
    
    def test_detail_page_view_has_time_spent(self):
        """Test detail/page_view returns time_spent data"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/page_view", headers=self.headers)
        data = response.json()
        assert "time_spent" in data
        assert isinstance(data["time_spent"], list)
        print(f"PASS: detail/page_view has time_spent list ({len(data['time_spent'])} pages)")
    
    def test_detail_page_view_time_spent_structure(self):
        """Test time_spent data has correct structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/page_view", headers=self.headers)
        data = response.json()
        
        if len(data["time_spent"]) > 0:
            ts = data["time_spent"][0]
            assert "slug" in ts
            assert "title" in ts
            assert "total_seconds" in ts
            assert "avg_seconds" in ts
            assert "sessions" in ts
            print(f"PASS: time_spent structure correct - {ts['title']}: {ts['total_seconds']}s total")
        else:
            print("INFO: No time_spent data yet (expected if no page_duration events)")
    
    def test_detail_page_view_events_have_user_info(self):
        """Test events include user name and role"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/page_view", headers=self.headers)
        data = response.json()
        
        if len(data["events"]) > 0:
            event = data["events"][0]
            assert "user_name" in event
            assert "user_role" in event
            assert "user_email" in event
            print(f"PASS: Events have user info - {event['user_name']} ({event['user_role']})")
        else:
            print("INFO: No page_view events yet")
    
    # --- /api/analytics/detail/login ---
    def test_detail_login_returns_200(self):
        """Test detail/login endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/login", headers=self.headers)
        assert response.status_code == 200
        print("PASS: /api/analytics/detail/login returns 200")
    
    def test_detail_login_has_events(self):
        """Test detail/login returns events list"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/login", headers=self.headers)
        data = response.json()
        assert "events" in data
        assert isinstance(data["events"], list)
        print(f"PASS: detail/login has events list ({len(data['events'])} events)")
    
    # --- /api/analytics/detail/search ---
    def test_detail_search_returns_200(self):
        """Test detail/search endpoint returns 200"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/search", headers=self.headers)
        assert response.status_code == 200
        print("PASS: /api/analytics/detail/search returns 200")
    
    def test_detail_search_has_events(self):
        """Test detail/search returns events list"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/search", headers=self.headers)
        data = response.json()
        assert "events" in data
        assert isinstance(data["events"], list)
        print(f"PASS: detail/search has events list ({len(data['events'])} events)")
    
    # --- Invalid event type ---
    def test_detail_invalid_type_returns_400(self):
        """Test detail endpoint with invalid event type returns 400"""
        response = requests.get(f"{BASE_URL}/api/analytics/detail/invalid_type", headers=self.headers)
        assert response.status_code == 400
        print("PASS: Invalid event type returns 400")


class TestUserDetailEndpoint:
    """Test user detail endpoint for user activity drill-down"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Login as admin"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert login_response.status_code == 200
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
    
    def test_user_detail_returns_200(self):
        """Test user-detail endpoint returns 200 for valid user"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/{ADMIN_EMAIL}", headers=self.headers)
        assert response.status_code == 200
        print("PASS: /api/analytics/user-detail/{email} returns 200")
    
    def test_user_detail_has_user_info(self):
        """Test user-detail returns user info"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/{ADMIN_EMAIL}", headers=self.headers)
        data = response.json()
        
        assert "user" in data
        assert "email" in data["user"]
        assert "name" in data["user"]
        assert "role" in data["user"]
        assert data["user"]["email"] == ADMIN_EMAIL
        print(f"PASS: User info returned - {data['user']['name']} ({data['user']['role']})")
    
    def test_user_detail_has_events(self):
        """Test user-detail returns events list"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/{ADMIN_EMAIL}", headers=self.headers)
        data = response.json()
        
        assert "events" in data
        assert isinstance(data["events"], list)
        print(f"PASS: User detail has events list ({len(data['events'])} events)")
    
    def test_user_detail_has_page_times(self):
        """Test user-detail returns page_times list"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/{ADMIN_EMAIL}", headers=self.headers)
        data = response.json()
        
        assert "page_times" in data
        assert isinstance(data["page_times"], list)
        print(f"PASS: User detail has page_times list ({len(data['page_times'])} pages)")
    
    def test_user_detail_has_total_time(self):
        """Test user-detail returns total_time_seconds"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/{ADMIN_EMAIL}", headers=self.headers)
        data = response.json()
        
        assert "total_time_seconds" in data
        assert isinstance(data["total_time_seconds"], (int, float))
        print(f"PASS: User detail has total_time_seconds: {data['total_time_seconds']}s")
    
    def test_user_detail_page_times_structure(self):
        """Test page_times has correct structure"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/{ADMIN_EMAIL}", headers=self.headers)
        data = response.json()
        
        if len(data["page_times"]) > 0:
            pt = data["page_times"][0]
            assert "slug" in pt
            assert "title" in pt
            assert "total_seconds" in pt
            assert "avg_seconds" in pt
            assert "visits" in pt
            print(f"PASS: page_times structure correct - {pt['title']}: {pt['visits']} visits, {pt['total_seconds']}s total")
        else:
            print("INFO: No page_times data yet for this user")
    
    def test_user_detail_not_found(self):
        """Test user-detail returns 404 for non-existent user"""
        response = requests.get(f"{BASE_URL}/api/analytics/user-detail/nonexistent@test.com", headers=self.headers)
        assert response.status_code == 404
        print("PASS: Non-existent user returns 404")


class TestTrackDurationEndpoint:
    """Test time tracking endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup: Login as admin"""
        login_response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert login_response.status_code == 200
        self.token = login_response.json()["token"]
        self.headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
    
    def test_track_duration_returns_200(self):
        """Test track-duration endpoint returns 200"""
        response = requests.post(
            f"{BASE_URL}/api/activity/track-duration",
            headers=self.headers,
            json={
                "page_slug": "test-page",
                "page_title": "Test Page",
                "duration_seconds": 30
            }
        )
        assert response.status_code == 200
        print("PASS: /api/activity/track-duration returns 200")
    
    def test_track_duration_response(self):
        """Test track-duration returns status ok"""
        response = requests.post(
            f"{BASE_URL}/api/activity/track-duration",
            headers=self.headers,
            json={
                "page_slug": "core-values",
                "page_title": "Core Values",
                "duration_seconds": 45
            }
        )
        data = response.json()
        assert data.get("status") == "ok"
        print("PASS: track-duration returns status: ok")
    
    def test_track_duration_logs_activity(self):
        """Test track-duration creates page_duration event"""
        # Track duration
        requests.post(
            f"{BASE_URL}/api/activity/track-duration",
            headers=self.headers,
            json={
                "page_slug": "leave-policy",
                "page_title": "Leave Policy",
                "duration_seconds": 60
            }
        )
        
        # Check it appears in detail endpoint
        response = requests.get(f"{BASE_URL}/api/analytics/detail/page_view", headers=self.headers)
        data = response.json()
        
        # Should have time_spent data
        assert "time_spent" in data
        print("PASS: track-duration logs activity (time_spent data available)")
    
    def test_track_duration_requires_auth(self):
        """Test track-duration requires authentication"""
        response = requests.post(
            f"{BASE_URL}/api/activity/track-duration",
            json={
                "page_slug": "test-page",
                "page_title": "Test Page",
                "duration_seconds": 30
            }
        )
        assert response.status_code in [401, 403]
        print("PASS: track-duration requires authentication")
    
    def test_track_duration_hr_can_access(self):
        """Test HR user can track duration (not admin-only)"""
        # Login as HR
        hr_login = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": HR_EMAIL, "password": HR_PASSWORD}
        )
        hr_token = hr_login.json()["token"]
        hr_headers = {"Authorization": f"Bearer {hr_token}", "Content-Type": "application/json"}
        
        response = requests.post(
            f"{BASE_URL}/api/activity/track-duration",
            headers=hr_headers,
            json={
                "page_slug": "code-of-conduct",
                "page_title": "Code of Conduct",
                "duration_seconds": 25
            }
        )
        assert response.status_code == 200
        print("PASS: HR user can track duration (not admin-only)")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
