from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class TimestampedModel(ORMModel):
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


T = TypeVar("T")


class PaginatedResponse(ORMModel, Generic[T]):
    data: list[T]
    total: int
    page: int
    limit: int
    total_pages: int = Field(alias="totalPages")


class MessageResponse(ORMModel):
    message: str

