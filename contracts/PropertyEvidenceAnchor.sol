// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// Anchors evidence hashes only; does not prove ownership or document truth.
contract PropertyEvidenceAnchor {
 address public immutable administrator;
 mapping(bytes32 => uint256) public firstAnchoredAt;
 event EvidenceAnchored(bytes32 indexed caseId, bytes32 indexed evidenceHash, address indexed actor, uint256 timestamp);
 error NotAdministrator(); error EmptyHash(); error AlreadyAnchored();
 constructor(){administrator=msg.sender;}
 function anchor(bytes32 caseId, bytes32 evidenceHash) external {
  if(msg.sender!=administrator) revert NotAdministrator();
  if(caseId==bytes32(0)||evidenceHash==bytes32(0)) revert EmptyHash();
  if(firstAnchoredAt[evidenceHash]!=0) revert AlreadyAnchored();
  firstAnchoredAt[evidenceHash]=block.timestamp;
  emit EvidenceAnchored(caseId,evidenceHash,msg.sender,block.timestamp);
 }
}
