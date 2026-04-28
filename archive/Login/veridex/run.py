import sys
sys.path.insert(0, '.')

from app.main import app
import uvicorn

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8003, reload=False)