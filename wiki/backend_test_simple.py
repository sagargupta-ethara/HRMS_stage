#!/usr/bin/env python3

import requests
import sys
import json
import os
from datetime import datetime

class WikiAPITester:
    def __init__(self, base_url=None):
        self.base_url = (base_url or os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8001")).rstrip("/")
        self.token = None
        self.user_data = None
        self.tests_run = 0
        self.tests_passed = 0
        self.created_page_slug = None

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} - {name}")
        if details:
            print(f"    Details: {details}")
        if success:
            self.tests_passed += 1

    def make_request(self, method, endpoint, data=None, expect_status=200, use_auth=True):
        """Make HTTP request with proper headers"""
        url = f"{self.base_url}/api/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        
        if use_auth and self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expect_status
            return success, response.json() if response.content else {}, response.status_code
        except Exception as e:
            return False, {"error": str(e)}, 0

    def test_health_check(self):
        """Test basic health endpoint"""
        success, data, status = self.make_request('GET', 'health', use_auth=False)
        self.log_test("Health Check", success and data.get('status') == 'ok')
        return success

    def setup_test_user(self):
        """Setup a test user for testing"""
        # Register a test user
        user_data = {
            "email": f"test_user_{datetime.now().strftime('%H%M%S')}@ethara.com",
            "name": "Test User",
            "password": "TestPassword123!"
        }
        
        success, data, status = self.make_request('POST', 'auth/register', user_data, 200, use_auth=False)
        
        if success and data.get('token'):
            self.token = data.get('token')
            self.user_data = data.get('user')
            
        self.log_test("Setup Test User", success, f"Role: {data.get('user', {}).get('role', 'Unknown')}")
        return success

    def test_get_categories(self):
        """Test get wiki categories"""
        success, data, status = self.make_request('GET', 'wiki/categories', expect_status=200)
        categories = data.get('categories', [])
        expected_categories = 8  # Should have 8 predefined categories
        
        success = success and len(categories) == expected_categories
        self.log_test("Get Categories", success, f"Found {len(categories)}/{expected_categories} categories")
        
        if success:
            # Print category names for verification
            category_names = [cat['name'] for cat in categories]
            print(f"    Categories: {', '.join(category_names)}")
        
        return success

    def test_get_wiki_pages(self):
        """Test getting wiki pages"""
        success, data, status = self.make_request('GET', 'wiki/pages', expect_status=200)
        pages = data.get('pages', [])
        self.log_test("Get Wiki Pages", success, f"Found {len(pages)} pages")
        return success

    def test_create_wiki_page_permission_check(self):
        """Test creating a wiki page (should fail for viewer role)"""
        page_data = {
            "title": "Test Wiki Page",
            "category": "foundation",
            "subcategory": "Core Values",
            "content_html": "<h1>Test Page</h1><p>This is a test wiki page.</p>",
            "content_text": "Test Page\nThis is a test wiki page."
        }
        
        # This should fail with 403 for viewer role
        success, data, status = self.make_request('POST', 'wiki/pages', page_data, 403)
        self.log_test("Create Wiki Page (Permission Check)", success, f"Status: {status} (Expected 403 for viewer)")
        return success

    def test_admin_get_users_permission_check(self):
        """Test admin functionality - get all users (should fail for non-admin)"""
        success, data, status = self.make_request('GET', 'users', expect_status=403)
        self.log_test("Admin - Get Users (Permission Check)", success, f"Status: {status} (Expected 403 for non-admin)")
        return success

    def test_user_profile(self):
        """Test get current user profile"""
        success, data, status = self.make_request('GET', 'auth/me', expect_status=200)
        user_info = data.get('user', {})
        self.log_test("Get User Profile", success, f"Email: {user_info.get('email')}, Role: {user_info.get('role')}")
        return success

def main():
    print("🚀 Starting Simplified Wiki API Tests...")
    print("=" * 60)
    
    tester = WikiAPITester()
    
    try:
        # Basic tests
        if not tester.test_health_check():
            print("❌ Health check failed - stopping tests")
            return 1
        
        # Setup a test user
        if not tester.setup_test_user():
            print("❌ Failed to setup test user - stopping tests")
            return 1
        
        # Authentication tests
        tester.test_user_profile()
        
        # Wiki functionality tests
        tester.test_get_categories()
        tester.test_get_wiki_pages()
        tester.test_create_wiki_page_permission_check()
        
        # Permission tests
        tester.test_admin_get_users_permission_check()
        
    except Exception as e:
        print(f"❌ Unexpected error: {str(e)}")
        return 1
    
    print("\n" + "=" * 60)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    
    success_rate = (tester.tests_passed / tester.tests_run) * 100 if tester.tests_run > 0 else 0
    print(f"🎯 Success Rate: {success_rate:.1f}%")
    
    return 0 if success_rate >= 70 else 1  # Pass if 70% or more tests pass

if __name__ == "__main__":
    sys.exit(main())
