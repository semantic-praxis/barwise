Facilitator: Thanks for making the time. I want to map how a supplier actually gets onboarded, end to end. Dana, you own procurement -- start wherever it starts for you.

Dana (Procurement Lead): It starts when a buyer raises a request for a new supplier. We create a vendor record, give it a vendor number, capture the legal name and the tax ID, and then it's a race to get them transacting.

Facilitator: What has to be true before they can transact?

Dana: Tax form on file. Once the W-9 is in, they're live and a buyer can raise a purchase order against them.

Raj (Compliance Officer): That's not right, Dana. That hasn't been true since March.

Dana: Since March?

Raj: The tax form gets you a vendor record. It does not get you transacting. A vendor cannot be set to active until a risk review is completed and signed off. That was the whole point of the audit finding.

Dana: I'll be honest, procurement has been treating the W-9 as the gate.

Raj: I know. That's a process problem, not a system problem -- the system does enforce it. You just can't move a vendor to active without a completed review.

Facilitator: So let me state it back. Every active vendor has a completed risk review. Is that the rule?

Raj: Exactly that. Every active vendor has exactly one completed risk review. Not zero.

Dana: Fine. I won't fight it, it's the rule.

Facilitator: Mei, you're closest to the system. Does it work that way?

Mei (Supplier Ops Analyst): It does. The review is its own record with a review ID, because we need to know who signed it and when. It's not just a flag on the vendor.

Facilitator: Tell me about tiers. Dana, you used the word earlier.

Dana: Every vendor gets a tier. Bronze, silver, or gold. It's about how much we spend with them annually -- gold suppliers get quarterly business reviews and better payment terms.

Raj: And every vendor gets a tier: low, medium, or high. Based on the risk review -- data access, geography, whether they're a sole source.

Facilitator: Those are both called tier.

Raj: They are, and it causes chaos in meetings. Someone says "that's a high tier vendor" and half the room hears "big spender" and half hears "dangerous."

Dana: We've asked people to say spend tier and risk tier. Nobody does.

Mei: They're separate fields in the system. Different values, different owners -- procurement sets one, compliance sets the other. A vendor can absolutely be gold and high, that's most of our cloud providers.

Facilitator: Good, that's clear. Let's do contacts. How does a vendor contact work?

Mei: Each vendor has one primary contact. Name, email, phone.

Facilitator: One, exactly one?

Mei: Yes -- well. Hold on. That was true, but it's wrong now. Since we moved to regional sourcing last year, it's one primary contact per region. So a vendor operating in EMEA and APAC has two primary contacts, one for each.

Facilitator: So the vendor and the region together determine the contact.

Mei: Right. A given vendor in a given region has exactly one primary contact. You can't have two people both primary for the same vendor in the same region -- the system rejects it.

Dana: And a vendor doesn't necessarily operate everywhere. Most of ours are one region only.

Facilitator: What identifies a region?

Mei: A region code. EMEA, APAC, NA, LATAM.

Facilitator: Now purchase orders. Dana?

Dana: A purchase order has a PO number, it's raised against exactly one vendor, and it carries an amount and a raised date. A vendor can have many POs, obviously, or none if they've never been used.

Facilitator: Can a PO be raised against a vendor who isn't active?

Dana: No. That's the control.

Raj: That's the control at creation. What we've never settled is what happens after.

Facilitator: Meaning?

Raj: If we suspend a vendor -- say their risk review lapses, or there's an incident -- what happens to the purchase orders already in flight? Compliance's position is everything halts immediately.

Dana: And that's operationally impossible. We have POs with goods on a ship. You cannot halt a PO that's already shipped, you'd have inventory sitting in a port with no receiving authority.

Raj: I understand the objection. My problem is that "keep fulfilling" is exactly the exposure the audit flagged.

Dana: Then we need a middle state, something like run-off, where existing POs complete but no new ones can be raised.

Raj: Maybe. I'm not agreeing to that in this room.

Facilitator: Is this something we can settle today?

Raj: No. This goes to the sourcing steering group -- it's a policy call, not a modeling call, and Legal needs to be in the room.

Dana: Agreed. Park it.

Facilitator: Parking it. Let me confirm the vendor statuses you do have today.

Mei: Draft, active, suspended. Every vendor is in exactly one of those three.

Facilitator: And suspended vendors -- can they hold a completed risk review?

Mei: They can, and usually do. Suspension doesn't delete the review, it just changes the status. The rule is only that you can't be active without one.

Facilitator: Last thing. Does a risk review belong to one vendor?

Raj: One review, one vendor. And we keep the old ones -- when a vendor is re-reviewed, that's a new review record, not an edit to the old one.

Mei: Which means a vendor can have several reviews over time, but at most one that's the current signed-off one.

Facilitator: Good. That's what I needed.
