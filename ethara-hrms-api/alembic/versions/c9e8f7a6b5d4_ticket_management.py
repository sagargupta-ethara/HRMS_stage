"""ticket_management

Revision ID: c9e8f7a6b5d4
Revises: b4d6f8a0c2e1
Create Date: 2026-06-06 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c9e8f7a6b5d4"
down_revision: str | None = "b4d6f8a0c2e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("notifications", sa.Column("entityType", sa.String(length=100), nullable=True))
    op.add_column("notifications", sa.Column("entityId", sa.String(length=32), nullable=True))
    op.add_column("notifications", sa.Column("payload", sa.JSON(), nullable=True))
    op.create_index("ix_notifications_entityType", "notifications", ["entityType"])
    op.create_index("ix_notifications_entityId", "notifications", ["entityId"])

    op.create_table(
        "ticket_number_counters",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("nextNumber", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", name="uq_ticket_number_counters_year"),
    )
    op.create_index("ix_ticket_number_counters_year", "ticket_number_counters", ["year"])

    op.create_table(
        "ticket_queues",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("ownerRole", sa.String(length=100), nullable=False),
        sa.Column("defaultAssigneeId", sa.String(length=32), nullable=True),
        sa.Column("allowedCreatorRoles", sa.JSON(), nullable=True),
        sa.Column("isActive", sa.Boolean(), nullable=False),
        sa.Column("sortOrder", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["defaultAssigneeId"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", name="uq_ticket_queues_key"),
    )
    op.create_index("ix_ticket_queues_isActive_sortOrder", "ticket_queues", ["isActive", "sortOrder"])

    op.create_table(
        "ticket_categories",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("queueId", sa.String(length=32), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("defaultPriority", sa.String(length=20), nullable=True),
        sa.Column("defaultAssigneeId", sa.String(length=32), nullable=True),
        sa.Column("formSchema", sa.JSON(), nullable=True),
        sa.Column("isActive", sa.Boolean(), nullable=False),
        sa.Column("sortOrder", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["defaultAssigneeId"], ["users.id"]),
        sa.ForeignKeyConstraint(["queueId"], ["ticket_queues.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("queueId", "key", name="uq_ticket_categories_queueId_key"),
    )
    op.create_index(
        "ix_ticket_categories_queueId_isActive_sortOrder",
        "ticket_categories",
        ["queueId", "isActive", "sortOrder"],
    )
    op.create_index("ix_ticket_categories_queueId", "ticket_categories", ["queueId"])

    op.create_table(
        "ticket_sla_policies",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("queueId", sa.String(length=32), nullable=False),
        sa.Column("categoryId", sa.String(length=32), nullable=True),
        sa.Column("priority", sa.String(length=20), nullable=True),
        sa.Column("firstResponseMinutes", sa.Integer(), nullable=False),
        sa.Column("resolutionMinutes", sa.Integer(), nullable=False),
        sa.Column("escalationMinutes", sa.Integer(), nullable=True),
        sa.Column("escalationRole", sa.String(length=100), nullable=True),
        sa.Column("escalationUserId", sa.String(length=32), nullable=True),
        sa.Column("businessHours", sa.JSON(), nullable=True),
        sa.Column("isActive", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["categoryId"], ["ticket_categories.id"]),
        sa.ForeignKeyConstraint(["escalationUserId"], ["users.id"]),
        sa.ForeignKeyConstraint(["queueId"], ["ticket_queues.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("queueId", "categoryId", "priority", name="uq_ticket_sla_policies_scope"),
    )
    op.create_index(
        "ix_ticket_sla_policies_scope_active",
        "ticket_sla_policies",
        ["queueId", "categoryId", "priority", "isActive"],
    )
    op.create_index("ix_ticket_sla_policies_queueId", "ticket_sla_policies", ["queueId"])
    op.create_index("ix_ticket_sla_policies_categoryId", "ticket_sla_policies", ["categoryId"])

    op.create_table(
        "tickets",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("ticketNumber", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("priority", sa.String(length=20), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("queueId", sa.String(length=32), nullable=False),
        sa.Column("categoryId", sa.String(length=32), nullable=True),
        sa.Column("createdByUserId", sa.String(length=32), nullable=True),
        sa.Column("requesterUserId", sa.String(length=32), nullable=True),
        sa.Column("requesterRole", sa.String(length=100), nullable=True),
        sa.Column("requesterEmployeeProfileId", sa.String(length=32), nullable=True),
        sa.Column("requesterCandidateId", sa.String(length=32), nullable=True),
        sa.Column("requesterVendorId", sa.String(length=32), nullable=True),
        sa.Column("requestedForUserId", sa.String(length=32), nullable=True),
        sa.Column("relatedEntityType", sa.String(length=100), nullable=True),
        sa.Column("relatedEntityId", sa.String(length=32), nullable=True),
        sa.Column("assignedToId", sa.String(length=32), nullable=True),
        sa.Column("assignedById", sa.String(length=32), nullable=True),
        sa.Column("assignedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("firstResponseDueAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("firstResponseAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dueAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolvedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelledAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolutionSummary", sa.Text(), nullable=True),
        sa.Column("satisfactionRating", sa.Integer(), nullable=True),
        sa.Column("satisfactionComment", sa.Text(), nullable=True),
        sa.Column("lastActivityAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["assignedById"], ["users.id"]),
        sa.ForeignKeyConstraint(["assignedToId"], ["users.id"]),
        sa.ForeignKeyConstraint(["categoryId"], ["ticket_categories.id"]),
        sa.ForeignKeyConstraint(["createdByUserId"], ["users.id"]),
        sa.ForeignKeyConstraint(["queueId"], ["ticket_queues.id"]),
        sa.ForeignKeyConstraint(["requestedForUserId"], ["users.id"]),
        sa.ForeignKeyConstraint(["requesterCandidateId"], ["candidates.id"]),
        sa.ForeignKeyConstraint(["requesterEmployeeProfileId"], ["employee_profiles.id"]),
        sa.ForeignKeyConstraint(["requesterUserId"], ["users.id"]),
        sa.ForeignKeyConstraint(["requesterVendorId"], ["vendors.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ticketNumber", name="uq_tickets_ticketNumber"),
    )
    op.create_index("ix_tickets_assignedToId_status", "tickets", ["assignedToId", "status"])
    op.create_index("ix_tickets_dueAt_status", "tickets", ["dueAt", "status"])
    op.create_index("ix_tickets_firstResponseDueAt", "tickets", ["firstResponseDueAt"])
    op.create_index("ix_tickets_lastActivityAt", "tickets", ["lastActivityAt"])
    op.create_index("ix_tickets_priority_status", "tickets", ["priority", "status"])
    op.create_index("ix_tickets_queueId_categoryId", "tickets", ["queueId", "categoryId"])
    op.create_index("ix_tickets_relatedEntityType_relatedEntityId", "tickets", ["relatedEntityType", "relatedEntityId"])
    op.create_index("ix_tickets_requesterCandidateId", "tickets", ["requesterCandidateId"])
    op.create_index("ix_tickets_requesterEmployeeProfileId", "tickets", ["requesterEmployeeProfileId"])
    op.create_index("ix_tickets_requesterUserId_status", "tickets", ["requesterUserId", "status"])
    op.create_index("ix_tickets_requesterVendorId", "tickets", ["requesterVendorId"])
    op.create_index("ix_tickets_status_queueId", "tickets", ["status", "queueId"])

    op.create_table(
        "ticket_comments",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("ticketId", sa.String(length=32), nullable=False),
        sa.Column("authorUserId", sa.String(length=32), nullable=False),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("editedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["authorUserId"], ["users.id"]),
        sa.ForeignKeyConstraint(["ticketId"], ["tickets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_comments_authorUserId", "ticket_comments", ["authorUserId"])
    op.create_index("ix_ticket_comments_authorUserId_created_at", "ticket_comments", ["authorUserId", "created_at"])
    op.create_index("ix_ticket_comments_ticketId", "ticket_comments", ["ticketId"])
    op.create_index("ix_ticket_comments_ticketId_created_at", "ticket_comments", ["ticketId", "created_at"])

    op.create_table(
        "ticket_attachments",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("ticketId", sa.String(length=32), nullable=False),
        sa.Column("commentId", sa.String(length=32), nullable=True),
        sa.Column("uploadedById", sa.String(length=32), nullable=False),
        sa.Column("fileName", sa.String(length=255), nullable=False),
        sa.Column("fileUrl", sa.String(length=500), nullable=True),
        sa.Column("storageKey", sa.String(length=500), nullable=False),
        sa.Column("fileSize", sa.Integer(), nullable=True),
        sa.Column("mimeType", sa.String(length=255), nullable=True),
        sa.Column("visibility", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["commentId"], ["ticket_comments.id"]),
        sa.ForeignKeyConstraint(["ticketId"], ["tickets.id"]),
        sa.ForeignKeyConstraint(["uploadedById"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_attachments_commentId", "ticket_attachments", ["commentId"])
    op.create_index("ix_ticket_attachments_ticketId", "ticket_attachments", ["ticketId"])
    op.create_index("ix_ticket_attachments_ticketId_created_at", "ticket_attachments", ["ticketId", "created_at"])
    op.create_index("ix_ticket_attachments_uploadedById", "ticket_attachments", ["uploadedById"])

    op.create_table(
        "ticket_events",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("ticketId", sa.String(length=32), nullable=False),
        sa.Column("eventType", sa.String(length=100), nullable=False),
        sa.Column("actorUserId", sa.String(length=32), nullable=True),
        sa.Column("fromStatus", sa.String(length=50), nullable=True),
        sa.Column("toStatus", sa.String(length=50), nullable=True),
        sa.Column("fromAssigneeId", sa.String(length=32), nullable=True),
        sa.Column("toAssigneeId", sa.String(length=32), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actorUserId"], ["users.id"]),
        sa.ForeignKeyConstraint(["fromAssigneeId"], ["users.id"]),
        sa.ForeignKeyConstraint(["ticketId"], ["tickets.id"]),
        sa.ForeignKeyConstraint(["toAssigneeId"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ticket_events_actorUserId", "ticket_events", ["actorUserId"])
    op.create_index("ix_ticket_events_actorUserId_createdAt", "ticket_events", ["actorUserId", "createdAt"])
    op.create_index("ix_ticket_events_eventType", "ticket_events", ["eventType"])
    op.create_index("ix_ticket_events_eventType_createdAt", "ticket_events", ["eventType", "createdAt"])
    op.create_index("ix_ticket_events_ticketId", "ticket_events", ["ticketId"])
    op.create_index("ix_ticket_events_ticketId_createdAt", "ticket_events", ["ticketId", "createdAt"])

    op.create_table(
        "ticket_watchers",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("ticketId", sa.String(length=32), nullable=False),
        sa.Column("userId", sa.String(length=32), nullable=False),
        sa.Column("notificationLevel", sa.String(length=20), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["ticketId"], ["tickets.id"]),
        sa.ForeignKeyConstraint(["userId"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ticketId", "userId", name="uq_ticket_watchers_ticketId_userId"),
    )
    op.create_index("ix_ticket_watchers_ticketId", "ticket_watchers", ["ticketId"])
    op.create_index("ix_ticket_watchers_userId", "ticket_watchers", ["userId"])

    op.create_table(
        "ticket_sla_breaches",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("ticketId", sa.String(length=32), nullable=False),
        sa.Column("breachType", sa.String(length=30), nullable=False),
        sa.Column("dueAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("breachedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("escalationLevel", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("notifiedRole", sa.String(length=100), nullable=True),
        sa.Column("notifiedUserId", sa.String(length=32), nullable=True),
        sa.Column("resolvedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["notifiedUserId"], ["users.id"]),
        sa.ForeignKeyConstraint(["ticketId"], ["tickets.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ticketId", "breachType", "escalationLevel", name="uq_ticket_sla_breaches_ticketId_type_level"),
    )
    op.create_index("ix_ticket_sla_breaches_notifiedRole_status", "ticket_sla_breaches", ["notifiedRole", "status"])
    op.create_index("ix_ticket_sla_breaches_notifiedUserId_status", "ticket_sla_breaches", ["notifiedUserId", "status"])
    op.create_index("ix_ticket_sla_breaches_status_breachedAt", "ticket_sla_breaches", ["status", "breachedAt"])
    op.create_index("ix_ticket_sla_breaches_ticketId", "ticket_sla_breaches", ["ticketId"])
    op.create_index("ix_ticket_sla_breaches_ticketId_breachType", "ticket_sla_breaches", ["ticketId", "breachType"])


def downgrade() -> None:
    op.drop_index("ix_ticket_sla_breaches_ticketId_breachType", table_name="ticket_sla_breaches")
    op.drop_index("ix_ticket_sla_breaches_ticketId", table_name="ticket_sla_breaches")
    op.drop_index("ix_ticket_sla_breaches_status_breachedAt", table_name="ticket_sla_breaches")
    op.drop_index("ix_ticket_sla_breaches_notifiedUserId_status", table_name="ticket_sla_breaches")
    op.drop_index("ix_ticket_sla_breaches_notifiedRole_status", table_name="ticket_sla_breaches")
    op.drop_table("ticket_sla_breaches")

    op.drop_index("ix_ticket_watchers_userId", table_name="ticket_watchers")
    op.drop_index("ix_ticket_watchers_ticketId", table_name="ticket_watchers")
    op.drop_table("ticket_watchers")

    op.drop_index("ix_ticket_events_ticketId_createdAt", table_name="ticket_events")
    op.drop_index("ix_ticket_events_ticketId", table_name="ticket_events")
    op.drop_index("ix_ticket_events_eventType_createdAt", table_name="ticket_events")
    op.drop_index("ix_ticket_events_eventType", table_name="ticket_events")
    op.drop_index("ix_ticket_events_actorUserId_createdAt", table_name="ticket_events")
    op.drop_index("ix_ticket_events_actorUserId", table_name="ticket_events")
    op.drop_table("ticket_events")

    op.drop_index("ix_ticket_attachments_uploadedById", table_name="ticket_attachments")
    op.drop_index("ix_ticket_attachments_ticketId_created_at", table_name="ticket_attachments")
    op.drop_index("ix_ticket_attachments_ticketId", table_name="ticket_attachments")
    op.drop_index("ix_ticket_attachments_commentId", table_name="ticket_attachments")
    op.drop_table("ticket_attachments")

    op.drop_index("ix_ticket_comments_ticketId_created_at", table_name="ticket_comments")
    op.drop_index("ix_ticket_comments_ticketId", table_name="ticket_comments")
    op.drop_index("ix_ticket_comments_authorUserId_created_at", table_name="ticket_comments")
    op.drop_index("ix_ticket_comments_authorUserId", table_name="ticket_comments")
    op.drop_table("ticket_comments")

    op.drop_index("ix_tickets_status_queueId", table_name="tickets")
    op.drop_index("ix_tickets_requesterVendorId", table_name="tickets")
    op.drop_index("ix_tickets_requesterUserId_status", table_name="tickets")
    op.drop_index("ix_tickets_requesterEmployeeProfileId", table_name="tickets")
    op.drop_index("ix_tickets_requesterCandidateId", table_name="tickets")
    op.drop_index("ix_tickets_relatedEntityType_relatedEntityId", table_name="tickets")
    op.drop_index("ix_tickets_queueId_categoryId", table_name="tickets")
    op.drop_index("ix_tickets_priority_status", table_name="tickets")
    op.drop_index("ix_tickets_lastActivityAt", table_name="tickets")
    op.drop_index("ix_tickets_firstResponseDueAt", table_name="tickets")
    op.drop_index("ix_tickets_dueAt_status", table_name="tickets")
    op.drop_index("ix_tickets_assignedToId_status", table_name="tickets")
    op.drop_table("tickets")

    op.drop_index("ix_ticket_sla_policies_categoryId", table_name="ticket_sla_policies")
    op.drop_index("ix_ticket_sla_policies_queueId", table_name="ticket_sla_policies")
    op.drop_index("ix_ticket_sla_policies_scope_active", table_name="ticket_sla_policies")
    op.drop_table("ticket_sla_policies")

    op.drop_index("ix_ticket_categories_queueId", table_name="ticket_categories")
    op.drop_index("ix_ticket_categories_queueId_isActive_sortOrder", table_name="ticket_categories")
    op.drop_table("ticket_categories")

    op.drop_index("ix_ticket_queues_isActive_sortOrder", table_name="ticket_queues")
    op.drop_table("ticket_queues")

    op.drop_index("ix_ticket_number_counters_year", table_name="ticket_number_counters")
    op.drop_table("ticket_number_counters")

    op.drop_index("ix_notifications_entityId", table_name="notifications")
    op.drop_index("ix_notifications_entityType", table_name="notifications")
    op.drop_column("notifications", "payload")
    op.drop_column("notifications", "entityId")
    op.drop_column("notifications", "entityType")
