import React from 'react'
import { FallbackPermissionRequest } from '../../components/permissions/FallbackPermissionRequest.js'
import type { PermissionRequestProps } from '../../components/permissions/PermissionRequest.js'

export const WorkflowPermissionRequest: React.ComponentType<PermissionRequestProps> =
  FallbackPermissionRequest
