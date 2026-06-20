from django.db import models

from . import db_crypto


class EncryptedTextField(models.TextField):
    """TextField that stores Fernet-encrypted values at rest."""

    description = 'Encrypted text field'

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        return db_crypto.decrypt(value)

    def get_prep_value(self, value):
        if value is None:
            return value
        return db_crypto.encrypt(value)

    def to_python(self, value):
        if value is None:
            return value
        if isinstance(value, str) and db_crypto.is_encrypted(value):
            return db_crypto.decrypt(value)
        return value


class EncryptedCharField(models.CharField):
    """CharField that stores Fernet-encrypted values at rest."""

    description = 'Encrypted char field'

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        return db_crypto.decrypt(value)

    def get_prep_value(self, value):
        if value is None:
            return value
        encrypted = db_crypto.encrypt(value)
        if self.max_length and len(encrypted) > self.max_length:
            raise ValueError(
                f'Encrypted value exceeds max_length={self.max_length} for {self.name}'
            )
        return encrypted

    def to_python(self, value):
        if value is None:
            return value
        if isinstance(value, str) and db_crypto.is_encrypted(value):
            return db_crypto.decrypt(value)
        return value
