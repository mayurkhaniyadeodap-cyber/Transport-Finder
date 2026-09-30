from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

# BigInteger PKs need Integer on SQLite to autoincrement (used by tests only).
_PK = BigInteger().with_variant(Integer(), "sqlite")


class TransportPincode(Base):
    __tablename__ = "transport_pincode"
    __table_args__ = (
        UniqueConstraint("transport_name", "pincode", "branch_name", name="uq_transport_pincode_branch"),
        Index("idx_pincode", "pincode"),
        Index("idx_city_state", "city", "state"),
        Index("idx_transport_pincode", "transport_name", "pincode"),
    )

    id: Mapped[int] = mapped_column(_PK, primary_key=True, autoincrement=True)
    transport_name: Mapped[str] = mapped_column(String(100), nullable=False)
    pincode: Mapped[str] = mapped_column(String(10), nullable=False)
    branch_name: Mapped[str] = mapped_column(String(150), nullable=False, default="")
    city: Mapped[str | None] = mapped_column(String(150))
    location: Mapped[str | None] = mapped_column(String(150))
    district: Mapped[str | None] = mapped_column(String(150))
    state: Mapped[str | None] = mapped_column(String(150))
    pincode_type: Mapped[str | None] = mapped_column(String(50))
    documents_required: Mapped[str | None] = mapped_column(Text)
    surface_delivery: Mapped[bool | None] = mapped_column(Boolean)
    air_delivery: Mapped[bool | None] = mapped_column(Boolean)
    rail_delivery: Mapped[bool | None] = mapped_column(Boolean)
    source_url: Mapped[str | None] = mapped_column(Text)
    last_updated: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())


class TransportBranch(Base):
    __tablename__ = "transport_branch"
    __table_args__ = (
        UniqueConstraint("transport_name", "branch_name", "pincode", name="uq_branch"),
        Index("idx_branch_pincode", "pincode"),
        Index("idx_branch_city_state", "city", "state"),
        Index("idx_branch_transport", "transport_name"),
    )

    id: Mapped[int] = mapped_column(_PK, primary_key=True, autoincrement=True)
    transport_name: Mapped[str] = mapped_column(String(100), nullable=False)
    branch_name: Mapped[str] = mapped_column(String(150), nullable=False, default="")
    branch_type: Mapped[str | None] = mapped_column(String(100))
    godown_name: Mapped[str | None] = mapped_column(String(150))
    contact_number: Mapped[str | None] = mapped_column(String(255))
    alternate_contact: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(150))
    district: Mapped[str | None] = mapped_column(String(150))
    state: Mapped[str | None] = mapped_column(String(150))
    pincode: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    latitude: Mapped[float | None] = mapped_column(Numeric(10, 7))
    longitude: Mapped[float | None] = mapped_column(Numeric(10, 7))
    source_url: Mapped[str | None] = mapped_column(Text)
    last_updated: Mapped[datetime | None] = mapped_column(DateTime, server_default=func.now())
