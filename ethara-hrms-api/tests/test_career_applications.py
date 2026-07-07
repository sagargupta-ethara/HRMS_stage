from datetime import UTC, datetime, timedelta

from app.db.models import CareerApplication


def test_list_career_applications_supports_offset_pagination(client, db_session, auth_headers):
    now = datetime.now(UTC)
    db_session.add_all(
        [
            CareerApplication(
                id=f"career-app-{index:02d}",
                full_name=f"Applicant {index:02d}",
                email=f"applicant{index:02d}@example.com",
                phone="9876543210",
                linkedin_url="https://linkedin.com/in/applicant",
                resume_file_name="resume.pdf",
                resume_url="/uploads/career_applications/resume.pdf",
                resume_mime_type="application/pdf",
                resume_size=1234,
                status="new",
                created_at=now - timedelta(minutes=index),
                updated_at=now - timedelta(minutes=index),
            )
            for index in range(25)
        ]
    )
    db_session.commit()

    response = client.get(
        "/api/v1/applications",
        params={"limit": 20, "offset": 20},
        headers=auth_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 5
    assert [application["fullName"] for application in body] == [
        "Applicant 20",
        "Applicant 21",
        "Applicant 22",
        "Applicant 23",
        "Applicant 24",
    ]
