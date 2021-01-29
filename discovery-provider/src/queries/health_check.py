from datetime import datetime
import logging
from flask import Blueprint, request
from src.queries.get_latest_play import get_latest_play
from src.queries.queries import parse_bool_param
from src.api_helpers import success_response
from src.queries.get_health import get_health
from src.utils import helpers

logger = logging.getLogger(__name__)

bp = Blueprint("health_check", __name__)

disc_prov_version = helpers.get_discovery_provider_version()


@bp.route("/version", methods=["GET"])
def version():
    return success_response(
        disc_prov_version,
        sign_response=False
    )

# Health check for server, db, and redis. Consumes latest block data from redis instead of chain.
# Optional boolean "verbose" flag to output db connection info.
# Optional boolean "enforce_block_diff" flag to error on unhealthy blockdiff.
# NOTE - can extend this in future to include ganache connectivity, how recently a block
#   has been added (ex. if it's been more than 30 minutes since last block), etc.
@bp.route("/health_check", methods=["GET"])
def health_check():
    args = {
        "verbose": parse_bool_param(request.args.get("verbose")),
        "healthy_block_diff": request.args.get("healthy_block_diff", type=int),
        "enforce_block_diff": parse_bool_param(request.args.get("enforce_block_diff"))
    }

    (health_results, error) = get_health(args)
    return success_response(
        health_results,
        500 if error else 200,
        sign_response=False
    )


# Health check for block diff between DB and chain.
@bp.route("/block_check", methods=["GET"])
def block_check():
    args = {
        "verbose": parse_bool_param(request.args.get("verbose")),
        "healthy_block_diff": request.args.get("healthy_block_diff", type=int),
        "enforce_block_diff": True
    }

    (health_results, error) = get_health(args, use_redis_cache=False)
    return success_response(
        health_results,
        500 if error else 200,
        sign_response=False
    )

# Health check for latest play stored in the db
@bp.route("/play_check", methods=["GET"])
def play_check():
    """
       max_drift: maximum duration in seconds between `now` and the
        latest recorded play record to be considered healthy
    """
    max_drift = request.args.get("max_drift", type=int)

    latest_play = get_latest_play()
    drift = (datetime.now() - latest_play).total_seconds()

    # Error if max drift was provided and the drift is greater than max_drift
    error = max_drift and drift > max_drift

    return success_response(
        latest_play,
        500 if error else 200,
        sign_response=False
    )
