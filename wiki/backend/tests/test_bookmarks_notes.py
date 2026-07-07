"""
Test cases for Bookmark and Notes features
Features tested:
- Bookmark CRUD (Create, Read, Update, Delete)
- Notes CRUD (Create, Read, Update, Delete)
- Export notes with page content
- Data persistence verification
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials (from env, with safe defaults for local CI)
TEST_USER_EMAIL = os.environ.get('TEST_USER_EMAIL', 'testuser@example.com')
TEST_USER_PASSWORD = os.environ.get('TEST_USER_PASSWORD') or os.environ.get('TEST_USER_BOOTSTRAP_PASSWORD', 'test123')
TEST_PAGE_SLUG = "core-values"


class TestAuthSetup:
    """Authentication setup for all tests"""
    
    @pytest.fixture(scope="class")
    def auth_token(self):
        """Get authentication token"""
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


class TestBookmarkEndpoints(TestAuthSetup):
    """Bookmark API endpoint tests"""
    
    def test_create_bookmark(self, auth_headers):
        """Test creating a bookmark saves scroll position"""
        response = requests.post(f"{BASE_URL}/api/bookmarks", 
            headers=auth_headers,
            json={
                "page_slug": TEST_PAGE_SLUG,
                "scroll_position": 50.0
            }
        )
        assert response.status_code == 200, f"Create bookmark failed: {response.text}"
        data = response.json()
        assert "scroll_position" in data
        assert data["scroll_position"] == 50.0
        print(f"✓ Bookmark created with scroll_position: {data['scroll_position']}")
    
    def test_get_bookmark_for_page(self, auth_headers):
        """Test getting bookmark for a specific page"""
        response = requests.get(f"{BASE_URL}/api/bookmarks/{TEST_PAGE_SLUG}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Get bookmark failed: {response.text}"
        data = response.json()
        assert "bookmark" in data
        if data["bookmark"]:
            assert data["bookmark"]["page_slug"] == TEST_PAGE_SLUG
            print(f"✓ Bookmark retrieved: page_slug={data['bookmark']['page_slug']}, scroll_position={data['bookmark']['scroll_position']}")
        else:
            print("✓ No bookmark found for this page (valid response)")
    
    def test_update_bookmark_scroll_position(self, auth_headers):
        """Test updating bookmark updates scroll position"""
        # Create/update bookmark with new position
        response = requests.post(f"{BASE_URL}/api/bookmarks",
            headers=auth_headers,
            json={
                "page_slug": TEST_PAGE_SLUG,
                "scroll_position": 75.5
            }
        )
        assert response.status_code == 200, f"Update bookmark failed: {response.text}"
        data = response.json()
        assert data["scroll_position"] == 75.5
        
        # Verify persistence by getting the bookmark
        verify_response = requests.get(f"{BASE_URL}/api/bookmarks/{TEST_PAGE_SLUG}",
            headers=auth_headers
        )
        assert verify_response.status_code == 200
        verify_data = verify_response.json()
        assert verify_data["bookmark"]["scroll_position"] == 75.5
        print(f"✓ Bookmark updated and persisted: scroll_position={verify_data['bookmark']['scroll_position']}")
    
    def test_get_all_bookmarks(self, auth_headers):
        """Test getting all user bookmarks"""
        response = requests.get(f"{BASE_URL}/api/bookmarks",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Get all bookmarks failed: {response.text}"
        data = response.json()
        assert "bookmarks" in data
        assert isinstance(data["bookmarks"], list)
        print(f"✓ All bookmarks retrieved: count={len(data['bookmarks'])}")
    
    def test_delete_bookmark(self, auth_headers):
        """Test deleting a bookmark"""
        # First ensure bookmark exists
        requests.post(f"{BASE_URL}/api/bookmarks",
            headers=auth_headers,
            json={
                "page_slug": "TEST_DELETE_BOOKMARK_PAGE",
                "scroll_position": 25.0
            }
        )
        
        # Delete the bookmark
        response = requests.delete(f"{BASE_URL}/api/bookmarks/TEST_DELETE_BOOKMARK_PAGE",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Delete bookmark failed: {response.text}"
        
        # Verify deletion
        verify_response = requests.get(f"{BASE_URL}/api/bookmarks/TEST_DELETE_BOOKMARK_PAGE",
            headers=auth_headers
        )
        verify_data = verify_response.json()
        assert verify_data["bookmark"] is None
        print("✓ Bookmark deleted successfully")
    
    def test_delete_nonexistent_bookmark(self, auth_headers):
        """Test deleting a bookmark that doesn't exist returns 404"""
        response = requests.delete(f"{BASE_URL}/api/bookmarks/NONEXISTENT_PAGE_12345",
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404 for nonexistent bookmark: {response.text}"
        print("✓ Delete nonexistent bookmark returns 404 as expected")


class TestNotesEndpoints(TestAuthSetup):
    """Notes API endpoint tests"""
    
    created_note_id = None
    
    def test_create_note(self, auth_headers):
        """Test creating a new note"""
        response = requests.post(f"{BASE_URL}/api/notes",
            headers=auth_headers,
            json={
                "page_slug": TEST_PAGE_SLUG,
                "content": "TEST_NOTE: This is a test note content"
            }
        )
        assert response.status_code == 200, f"Create note failed: {response.text}"
        data = response.json()
        assert "note" in data
        assert "id" in data["note"]
        assert data["note"]["content"] == "TEST_NOTE: This is a test note content"
        assert data["note"]["page_slug"] == TEST_PAGE_SLUG
        TestNotesEndpoints.created_note_id = data["note"]["id"]
        print(f"✓ Note created with id: {data['note']['id']}")
    
    def test_get_notes_for_page(self, auth_headers):
        """Test getting all notes for a specific page"""
        response = requests.get(f"{BASE_URL}/api/notes/{TEST_PAGE_SLUG}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Get notes failed: {response.text}"
        data = response.json()
        assert "notes" in data
        assert isinstance(data["notes"], list)
        print(f"✓ Notes for page retrieved: count={len(data['notes'])}")
    
    def test_get_all_notes(self, auth_headers):
        """Test getting all user notes"""
        response = requests.get(f"{BASE_URL}/api/notes",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Get all notes failed: {response.text}"
        data = response.json()
        assert "notes" in data
        assert isinstance(data["notes"], list)
        print(f"✓ All notes retrieved: count={len(data['notes'])}")
    
    def test_update_note(self, auth_headers):
        """Test updating an existing note"""
        # First create a note to update
        create_response = requests.post(f"{BASE_URL}/api/notes",
            headers=auth_headers,
            json={
                "page_slug": TEST_PAGE_SLUG,
                "content": "TEST_UPDATE_NOTE: Original content"
            }
        )
        note_id = create_response.json()["note"]["id"]
        
        # Update the note
        response = requests.put(f"{BASE_URL}/api/notes/{note_id}",
            headers=auth_headers,
            json={"content": "TEST_UPDATE_NOTE: Updated content"}
        )
        assert response.status_code == 200, f"Update note failed: {response.text}"
        data = response.json()
        assert data["note"]["content"] == "TEST_UPDATE_NOTE: Updated content"
        print(f"✓ Note updated successfully")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/notes/{note_id}", headers=auth_headers)
    
    def test_delete_note(self, auth_headers):
        """Test deleting a note"""
        # Create a note to delete
        create_response = requests.post(f"{BASE_URL}/api/notes",
            headers=auth_headers,
            json={
                "page_slug": TEST_PAGE_SLUG,
                "content": "TEST_DELETE_NOTE: To be deleted"
            }
        )
        note_id = create_response.json()["note"]["id"]
        
        # Delete the note
        response = requests.delete(f"{BASE_URL}/api/notes/{note_id}",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Delete note failed: {response.text}"
        print("✓ Note deleted successfully")
    
    def test_delete_nonexistent_note(self, auth_headers):
        """Test deleting a note that doesn't exist returns 404"""
        fake_id = "000000000000000000000000"  # Valid ObjectId format but doesn't exist
        response = requests.delete(f"{BASE_URL}/api/notes/{fake_id}",
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404: {response.text}"
        print("✓ Delete nonexistent note returns 404 as expected")
    
    def test_update_nonexistent_note(self, auth_headers):
        """Test updating a note that doesn't exist returns 404"""
        fake_id = "000000000000000000000000"
        response = requests.put(f"{BASE_URL}/api/notes/{fake_id}",
            headers=auth_headers,
            json={"content": "This should fail"}
        )
        assert response.status_code == 404, f"Expected 404: {response.text}"
        print("✓ Update nonexistent note returns 404 as expected")


class TestNotesExport(TestAuthSetup):
    """Notes export functionality tests"""
    
    def test_export_notes_with_content(self, auth_headers):
        """Test exporting notes with page content for PDF generation"""
        # First create a note for export
        create_response = requests.post(f"{BASE_URL}/api/notes",
            headers=auth_headers,
            json={
                "page_slug": TEST_PAGE_SLUG,
                "content": "TEST_EXPORT_NOTE: Note for export test"
            }
        )
        note_id = create_response.json()["note"]["id"]
        
        # Export notes
        response = requests.get(f"{BASE_URL}/api/notes/{TEST_PAGE_SLUG}/export",
            headers=auth_headers
        )
        assert response.status_code == 200, f"Export failed: {response.text}"
        data = response.json()
        
        # Verify export structure
        assert "page" in data
        assert "notes" in data
        assert "exported_at" in data
        assert "user_name" in data
        
        # Verify page content
        assert "title" in data["page"]
        assert "category" in data["page"]
        assert "content_text" in data["page"]
        
        print(f"✓ Export successful: page_title={data['page']['title']}, notes_count={len(data['notes'])}")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/notes/{note_id}", headers=auth_headers)
    
    def test_export_notes_nonexistent_page(self, auth_headers):
        """Test exporting from a page that doesn't exist returns 404"""
        response = requests.get(f"{BASE_URL}/api/notes/NONEXISTENT_PAGE_12345/export",
            headers=auth_headers
        )
        assert response.status_code == 404, f"Expected 404: {response.text}"
        print("✓ Export from nonexistent page returns 404 as expected")


class TestNotesPersistence(TestAuthSetup):
    """Test notes data persistence"""
    
    def test_notes_persist_across_requests(self, auth_headers):
        """Test that notes persist across requests (simulating refresh)"""
        # Create a note
        unique_content = "TEST_PERSIST: Note created for persistence test"
        create_response = requests.post(f"{BASE_URL}/api/notes",
            headers=auth_headers,
            json={
                "page_slug": TEST_PAGE_SLUG,
                "content": unique_content
            }
        )
        note_id = create_response.json()["note"]["id"]
        
        # Simulate "refresh" by making a new request
        get_response = requests.get(f"{BASE_URL}/api/notes/{TEST_PAGE_SLUG}",
            headers=auth_headers
        )
        notes = get_response.json()["notes"]
        
        # Find our note
        found_note = next((n for n in notes if n["id"] == note_id), None)
        assert found_note is not None, "Note not found after simulated refresh"
        assert found_note["content"] == unique_content
        print(f"✓ Note persists across requests")
        
        # Clean up
        requests.delete(f"{BASE_URL}/api/notes/{note_id}", headers=auth_headers)


class TestCleanup(TestAuthSetup):
    """Cleanup test data"""
    
    def test_cleanup_test_notes(self, auth_headers):
        """Clean up all TEST_ prefixed notes"""
        response = requests.get(f"{BASE_URL}/api/notes",
            headers=auth_headers
        )
        notes = response.json()["notes"]
        
        deleted_count = 0
        for note in notes:
            if note["content"].startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/notes/{note['id']}", headers=auth_headers)
                deleted_count += 1
        
        print(f"✓ Cleaned up {deleted_count} test notes")
        
    def test_cleanup_test_bookmarks(self, auth_headers):
        """Clean up test bookmarks"""
        # Clean up the main test bookmark
        requests.delete(f"{BASE_URL}/api/bookmarks/{TEST_PAGE_SLUG}", headers=auth_headers)
        print("✓ Cleaned up test bookmarks")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
