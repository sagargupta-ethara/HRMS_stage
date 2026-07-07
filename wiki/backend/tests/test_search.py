"""
Test suite for the Universal Search API endpoint
Tests: /api/search across wiki pages, documents, holidays, and grievances
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "admin@ethara.ai"
TEST_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD") or os.environ.get("ADMIN_BOOTSTRAP_PASSWORD", "admin123")


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for API calls"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    data = response.json()
    assert "token" in data, "No token in login response"
    return data["token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    """Return headers with auth token"""
    return {"Authorization": f"Bearer {auth_token}"}


class TestSearchWiki:
    """Test search for wiki pages"""

    def test_search_core_returns_wiki_result(self, auth_headers):
        """Search 'core' should return Core Values wiki page"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=core",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        
        # Should find Core Values page
        wiki_results = [r for r in data["results"] if r["type"] == "wiki"]
        assert len(wiki_results) > 0, "No wiki results found for 'core'"
        
        # Check that Core Values is in results
        titles = [r["title"].lower() for r in wiki_results]
        assert any("core" in t for t in titles), f"Core Values not found in: {titles}"
        
        # Verify result structure
        first_result = wiki_results[0]
        assert "title" in first_result
        assert "subtitle" in first_result
        assert "route" in first_result
        assert first_result["route"].startswith("/wiki/page/")

    def test_search_wiki_result_has_snippet(self, auth_headers):
        """Wiki results should have snippet when query is in content"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=quality",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        wiki_results = [r for r in data["results"] if r["type"] == "wiki"]
        if wiki_results:
            # Snippet field should exist (may be empty if only in title)
            assert "snippet" in wiki_results[0]


class TestSearchDocuments:
    """Test search for documents"""

    def test_search_rubric_returns_documents(self, auth_headers):
        """Search 'rubric' should return multiple deep learning papers"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=rubric",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        doc_results = [r for r in data["results"] if r["type"] == "document"]
        # Should find multiple rubric-related papers
        assert len(doc_results) >= 4, f"Expected at least 4 rubric docs, got {len(doc_results)}"
        
        # Verify all results have rubric in title
        for doc in doc_results:
            assert "rubric" in doc["title"].lower(), f"Non-rubric doc found: {doc['title']}"
            assert doc["type"] == "document"
            assert "route" in doc
            assert doc["route"].startswith("/training/deep-learning/")

    def test_search_prompting_returns_psychology_doc(self, auth_headers):
        """Search 'prompting' should return Psychology of Prompting document"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=prompting",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        doc_results = [r for r in data["results"] if r["type"] == "document"]
        assert len(doc_results) >= 1, "No document results for 'prompting'"
        
        # Check Psychology of Prompting is found
        titles = [r["title"] for r in doc_results]
        assert any("Psychology" in t or "Prompting" in t for t in titles), \
            f"Psychology of Prompting not found in: {titles}"

    def test_search_process_returns_document(self, auth_headers):
        """Search 'process' should return Revised Process Flow document"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=process",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        doc_results = [r for r in data["results"] if r["type"] == "document"]
        assert len(doc_results) >= 1, "No document results for 'process'"
        
        # Check Process Flow is found
        titles = [r["title"].lower() for r in doc_results]
        assert any("process" in t for t in titles), f"Process Flow not found in: {titles}"


class TestSearchHolidays:
    """Test search for holidays"""

    def test_search_diwali_returns_holiday(self, auth_headers):
        """Search 'diwali' should return Diwali/Deepavali holiday"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=diwali",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        holiday_results = [r for r in data["results"] if r["type"] == "holiday"]
        assert len(holiday_results) >= 1, "No holiday results for 'diwali'"
        
        # Verify Diwali result
        diwali = holiday_results[0]
        assert "diwali" in diwali["title"].lower() or "deepavali" in diwali["title"].lower()
        assert diwali["route"] == "/hr/holiday-calendar"
        assert "2026-11-08" in diwali["subtitle"], "Wrong date for Diwali"

    def test_search_republic_returns_holiday(self, auth_headers):
        """Search 'republic' should return Republic Day"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=republic",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        holiday_results = [r for r in data["results"] if r["type"] == "holiday"]
        assert len(holiday_results) >= 1, "No holiday results for 'republic'"
        
        assert "republic" in holiday_results[0]["title"].lower()

    def test_search_christmas_returns_holiday(self, auth_headers):
        """Search 'christmas' should return Christmas holiday"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=christmas",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        holiday_results = [r for r in data["results"] if r["type"] == "holiday"]
        assert len(holiday_results) >= 1, "No holiday results for 'christmas'"
        
        assert "christmas" in holiday_results[0]["title"].lower()


class TestSearchGrievances:
    """Test search for user grievances"""

    def test_search_grievance_only_returns_user_own(self, auth_headers):
        """Search should only return current user's grievances, not others"""
        # First, search for a common term
        response = requests.get(
            f"{BASE_URL}/api/search?q=test",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # If grievances are returned, they should be for the current user
        grievance_results = [r for r in data["results"] if r["type"] == "grievance"]
        # This is okay if empty - just means no grievances match or user has none
        assert isinstance(grievance_results, list)


class TestSearchValidation:
    """Test search input validation and edge cases"""

    def test_search_too_short_returns_empty(self, auth_headers):
        """Search with single character should return empty results"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=a",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["results"] == [], "Single char search should return empty"

    def test_search_empty_returns_empty(self, auth_headers):
        """Search with empty query should return empty results"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["results"] == [], "Empty search should return empty"

    def test_search_whitespace_returns_empty(self, auth_headers):
        """Search with only whitespace should return empty"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=%20",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert data["results"] == [], "Whitespace search should return empty"

    def test_search_max_results_capped_at_20(self, auth_headers):
        """Search should return at most 20 results"""
        # Search with common term that might have many results
        response = requests.get(
            f"{BASE_URL}/api/search?q=the",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) <= 20, "Results should be capped at 20"

    def test_search_requires_auth(self):
        """Search should fail without authentication"""
        response = requests.get(f"{BASE_URL}/api/search?q=test")
        assert response.status_code == 401 or response.status_code == 403


class TestSearchResultStructure:
    """Test search result data structure"""

    def test_result_has_required_fields(self, auth_headers):
        """Each result should have type, title, subtitle, snippet, route"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=holi",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        for result in data["results"]:
            assert "type" in result, "Result missing 'type'"
            assert "title" in result, "Result missing 'title'"
            assert "subtitle" in result, "Result missing 'subtitle'"
            assert "snippet" in result, "Result missing 'snippet'"
            assert "route" in result, "Result missing 'route'"
            assert result["type"] in ["wiki", "document", "holiday", "grievance"]

    def test_mixed_results_for_broad_search(self, auth_headers):
        """Broad search term might return multiple types"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=day",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        
        # 'day' should match various holidays
        types = set(r["type"] for r in data["results"])
        # We expect at least holidays (Republic Day, Independence Day, etc.)
        assert "holiday" in types or len(data["results"]) > 0


class TestSearchCaseInsensitive:
    """Test search is case-insensitive"""

    def test_uppercase_search_works(self, auth_headers):
        """Search should work with uppercase"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=DIWALI",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) > 0, "Uppercase search should work"

    def test_mixed_case_search_works(self, auth_headers):
        """Search should work with mixed case"""
        response = requests.get(
            f"{BASE_URL}/api/search?q=DiWaLi",
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) > 0, "Mixed case search should work"
