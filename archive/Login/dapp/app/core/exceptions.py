class AppError(Exception):
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)

class ExternalAPIError(AppError):
    def __init__(self, service: str, message: str):
        super().__init__(f"{service} API Error: {message}", 503)

class SerperAPIError(ExternalAPIError):
    def __init__(self, message: str):
        super().__init__("Serper", message)

class DatabaseError(AppError):
    def __init__(self, message: str):
        super().__init__(f"DB Error: {message}", 500)

class ValidationError(AppError):
    def __init__(self, message: str):
        super().__init__(f"Validation: {message}", 400)

class NotFoundError(AppError):
    def __init__(self, resource: str, id: str):
        super().__init__(f"{resource} not found: {id}", 404)

class ModelLoadError(AppError):
    def __init__(self, model: str):
        super().__init__(f"Model load failed: {model}", 500)