import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { SessionService } from "../auth/session.service.js";
import { ProfileService } from "./profile.service.js";
import { UpdateProfileDto } from "./profile.dto.js";

@UseGuards(AuthGuard)
@Controller("profile")
export class ProfileController {
  constructor(private readonly profiles:ProfileService,private readonly sessions:SessionService){}
  @Get() get(@Req() request:Request){return this.profiles.get(request.principal)}
  @Patch() update(@Req() request:Request,@Body() body:UpdateProfileDto){return this.profiles.update(request.principal,body,request)}
  @Get("sessions") listSessions(@Req() request:Request){return this.sessions.listMine(request.principal.id,request.aimsSessionId!)}
  @Delete("sessions/:id") revoke(@Req() request:Request,@Param("id",ParseUUIDPipe) id:string){return this.sessions.revokeMine(request.principal.id,id,request)}
  @Post("sessions/revoke-others") revokeOthers(@Req() request:Request){return this.sessions.revokeOthers(request.principal.id,request.aimsSessionId!,request)}
}
