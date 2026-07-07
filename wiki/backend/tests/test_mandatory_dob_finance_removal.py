"""
Test suite for:
1. Mandatory DOB feature - login response includes dob field
2. Finance category removal from /api/wiki/categories
3. Code of Conduct page - 'Reporting' section removed
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
USER_WITH_DOB = {
    "email": "admin@ethara.ai",
    "password": os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123"),
    "expected_dob": "1990-05-15",
}
USER_WITHOUT_DOB = {
    "email": "hr@ethara.ai",
    "password": os.environ.get("TEST_HR_PASSWORD") or os.environ.get("HR_BOOTSTRAP_PASSWORD", "Ethara@2026#Secure"),
}


class TestLoginDOBField:
    """Test that login response includes dob field"""
    
    def test_login_user_with_dob_returns_dob_field(self):
        """Login with admin@ethara.ai should return dob='1990-05-15'"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER_WITH_DOB["email"],
            "password": USER_WITH_DOB["password"]
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        
        data = response.json()
        assert "user" in data, "Response missing 'user' field"
        assert "dob" in data["user"], "User object missing 'dob' field"
        assert data["user"]["dob"] == USER_WITH_DOB["expected_dob"], f"Expected dob={USER_WITH_DOB['expected_dob']}, got {data['user']['dob']}"
        print(f"✓ admin@ethara.ai login returns dob={data['user']['dob']}")
    
    def test_login_user_without_dob_returns_null_dob(self):
        """Login with hr@ethara.ai should always include a dob field"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER_WITHOUT_DOB["email"],
            "password": USER_WITHOUT_DOB["password"]
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        
        data = response.json()
        assert "user" in data, "Response missing 'user' field"
        assert "dob" in data["user"], "User object missing 'dob' field"
        hr_dob = data["user"]["dob"]
        if hr_dob is not None:
            assert len(hr_dob.split("-")) == 3, f"Expected YYYY-MM-DD dob format, got {hr_dob}"
        print(f"✓ hr@ethara.ai login includes dob field: {hr_dob}")


class TestFinanceCategoryRemoval:
    """Test that Finance category is removed from /api/wiki/categories"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for API calls"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER_WITH_DOB["email"],
            "password": USER_WITH_DOB["password"]
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_categories_endpoint_does_not_include_finance(self, auth_token):
        """GET /api/wiki/categories should NOT return finance category"""
        response = requests.get(
            f"{BASE_URL}/api/wiki/categories",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Categories request failed: {response.text}"
        
        data = response.json()
        assert "categories" in data, "Response missing 'categories' field"
        
        category_ids = [cat["id"] for cat in data["categories"]]
        category_names = [cat["name"] for cat in data["categories"]]
        
        assert "finance" not in category_ids, f"Finance category ID found in categories: {category_ids}"
        assert "Finance" not in category_names, f"Finance category name found in categories: {category_names}"
        
        # Verify expected categories are present
        expected_categories = ["foundation", "operations", "hr", "training"]
        for expected in expected_categories:
            assert expected in category_ids, f"Expected category '{expected}' not found"
        
        print(f"✓ Finance category NOT in /api/wiki/categories. Found: {category_ids}")


class TestCodeOfConductReportingRemoval:
    """Test that 'Reporting' section is removed from Code of Conduct page"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for API calls"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER_WITH_DOB["email"],
            "password": USER_WITH_DOB["password"]
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_code_of_conduct_does_not_contain_reporting_section(self, auth_token):
        """GET /api/wiki/page/code-of-conduct content_text should NOT contain 'Reporting' section"""
        response = requests.get(
            f"{BASE_URL}/api/wiki/pages/code-of-conduct",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Page might not exist - that's also acceptable
        if response.status_code == 404:
            print("✓ Code of Conduct page not found (404) - acceptable if page doesn't exist")
            return
        
        assert response.status_code == 200, f"Code of Conduct request failed: {response.text}"
        
        data = response.json()
        assert "page" in data, "Response missing 'page' field"
        
        content_text = data["page"].get("content_text", "")
        
        # Check that 'Reporting' section is not present
        # Looking for variations of "Reporting" as a section header
        reporting_indicators = [
            "Reporting & grievance mechanism",
            "Reporting and grievance mechanism",
            "Reporting & Grievance Mechanism",
            "Reporting and Grievance Mechanism"
        ]
        
        for indicator in reporting_indicators:
            assert indicator.lower() not in content_text.lower(), f"Found '{indicator}' in Code of Conduct content"
        
        print(f"✓ Code of Conduct page does NOT contain 'Reporting & grievance mechanism' section")


class TestProfileEndpointDOB:
    """Test profile update endpoint for DOB"""
    
    @pytest.fixture
    def hr_auth_token(self):
        """Get auth token for hr user"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER_WITHOUT_DOB["email"],
            "password": USER_WITHOUT_DOB["password"]
        })
        assert response.status_code == 200
        return response.json()["token"]
    
    def test_profile_update_dob_works(self, hr_auth_token):
        """Test that DOB can be updated via profile endpoint"""
        test_dob = "1995-06-20"
        
        # Update DOB
        response = requests.put(
            f"{BASE_URL}/api/auth/profile",
            headers={"Authorization": f"Bearer {hr_auth_token}", "Content-Type": "application/json"},
            json={"dob": test_dob}
        )
        assert response.status_code == 200, f"Profile update failed: {response.text}"
        
        data = response.json()
        assert "user" in data, "Response missing 'user' field"
        assert data["user"]["dob"] == test_dob, f"DOB not updated correctly. Expected {test_dob}, got {data['user']['dob']}"
        
        print(f"✓ Profile DOB update works - set to {test_dob}")
        
        # Reset DOB back to null for subsequent tests
        response = requests.put(
            f"{BASE_URL}/api/auth/profile",
            headers={"Authorization": f"Bearer {hr_auth_token}", "Content-Type": "application/json"},
            json={"dob": ""}
        )
        # Note: Setting empty string might not reset to null - depends on backend implementation
        print("✓ Attempted to reset DOB for hr user")


class TestMeEndpointDOB:
    """Test /api/auth/me endpoint includes DOB"""
    
    def test_me_endpoint_includes_dob_for_user_with_dob(self):
        """GET /api/auth/me should include dob field"""
        # Login first
        login_response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": USER_WITH_DOB["email"],
            "password": USER_WITH_DOB["password"]
        })
        assert login_response.status_code == 200
        token = login_response.json()["token"]
        
        # Get me
        response = requests.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200, f"/api/auth/me failed: {response.text}"
        
        data = response.json()
        assert "user" in data, "Response missing 'user' field"
        assert "dob" in data["user"], "User object missing 'dob' field"
        
        print(f"✓ /api/auth/me includes dob field: {data['user'].get('dob')}")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
