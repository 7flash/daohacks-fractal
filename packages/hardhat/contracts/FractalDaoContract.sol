pragma solidity >=0.8.0 <0.9.0;
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; 
// https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol

contract FractalDaoContract is Ownable {

  event SetPurpose(address sender, string purpose);

  uint256 public treasuryAmount;

  mapping (uint256 => address) deedToContributor;

  mapping (uint256 => string) deedToDescription;

  // the highest ranked contribution is first one
  mapping (uint256 => uint256) deedToRating;

  uint256[] public deedsRating;

  uint256[] public fibo = [144, 89, 55, 34, 21, 13, 8, 5, 3, 2, 1];

  constructor() {}

  function setTreasuryAmount(uint256 amount) public onlyOwner {
    treasuryAmount = amount;
  }

  function contribute(string memory deed, uint256 upvoteDeedId) public {
    require(deedsRating.length < fibo.length, "max number of contributions, create new circle");

    uint256 deedId = deedsRating.length + 1;

    deedToContributor[deedId] = msg.sender;
    deedToDescription[deedId] = deed;
    deedToRating[deedId] = deedId;

    deedsRating.push(deedId);

    if (deedId > 1) {
      require(upvoteDeedId > 0 && upvoteDeedId <= deedsRating.length + 1, "unexpected upvoteDeedId, choose whom to upvote");

      uint256 deedRatingIdx = deedToRating[upvoteDeedId];
      uint256 nextHigherDeedId = deedsRating[deedRatingIdx - 1];

      deedsRating[deedRatingIdx] = nextHigherDeedId;
      deedsRating[deedRatingIdx - 1] = upvoteDeedId;

      deedToRating[upvoteDeedId] = deedToRating[upvoteDeedId] - 1; // going up
      deedToRating[nextHigherDeedId] = deedToRating[nextHigherDeedId] + 1; // going down
    }
  }

  function rewards() public view returns (uint256[11] memory) {
    uint256[11] memory amounts;

    uint256 idx = deedsRating.length;

    while (idx > 0) {
      amounts[idx] = idx * fibo[idx];
      idx--;
    }

    return amounts;
  }
  
  // to support receiving ETH by default
  receive() external payable {}
  fallback() external payable {}
}
