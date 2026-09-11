package com.example

sealed class User(val userId: String)
class AnonymousUser(userId: String) : User(userId)
class IdentifiedUser(userId: String, val email: String) : User(userId)
