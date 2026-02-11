from backend.service.user_service import list_users
from fastapi import FastAPI

app = FastAPI()


@app.get("/api/users")
def get_users():
    return list_users()
