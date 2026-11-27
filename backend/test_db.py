from sqlalchemy import text

from backend.postgres import create_postgres_engine


def main():
    engine = create_postgres_engine()
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        print("PostgreSQL connection verified.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
