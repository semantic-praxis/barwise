package com.example

import java.time.Instant

/** A product event, recorded per tenant. */
data class Event(
  val eventId: String,
  val tenant: Tenant,
  val name: String,
  val occurredAt: Instant,
  val properties: List<EventProperty> = emptyList(),
)
